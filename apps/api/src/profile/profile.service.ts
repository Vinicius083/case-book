import { isDeepStrictEqual } from 'node:util';

import {
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import {
  type HandleAvailability,
  handleAvailabilitySchema,
  handleProblem,
  normalizeHandle,
} from '@casebook/contracts/handle';
import {
  type MeResponse,
  meResponseSchema,
  type PublicProfileResponse,
  publicProfileResponseSchema,
  type UpdateProfileInput,
} from '@casebook/contracts/profile';
import {
  auditLog,
  type Database,
  type DbExecutor,
  type Transaction,
  mediaAssets,
  profiles,
  users,
} from '@casebook/db';

import { AuditService } from '../audit/audit.service.js';
import { PG_UNIQUE_VIOLATION, pgError } from '../common/pg-errors.js';
import { PROBLEM_TYPES, ProblemException } from '../common/problem.exception.js';
import { DB } from '../database/database.module.js';
import { HandleReservationsService } from '../handles/handle-reservations.service.js';

import type { RequestMeta } from '../common/http/request-meta.js';

/** Resposta de `/me` com o ETag do perfil, exigido em `If-Match` na edição. */
export interface MeWithEtag {
  me: MeResponse;
  etag: string;
}

export const HANDLE_CHANGE_COOLDOWN_DAYS = 30;
const HANDLE_CHANGE_COOLDOWN_MS = HANDLE_CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

// `profiles` não tem coluna de versão: o ETag é o `updated_at` em microssegundos
// (a precisão do Postgres; um `Date` do JS truncaria para milissegundos).
const profileVersion = sql<string>`(extract(epoch from ${profiles.updatedAt}) * 1000000)::bigint::text`;

// Colunas de `profiles` por campo do PATCH.
const PROFILE_COLUMNS = {
  display_name: 'displayName',
  bio: 'bio',
  location: 'location',
  roles: 'roles',
  links: 'links',
  avatar_media_id: 'avatarMediaId',
} as const satisfies Record<keyof UpdateProfileInput, keyof typeof profiles.$inferSelect>;

@Injectable()
export class ProfileService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly handleReservations: HandleReservationsService,
  ) {}

  async getMe(userId: string, executor: DbExecutor = this.db): Promise<MeWithEtag> {
    const [row] = await executor
      .select({
        id: users.id,
        email: users.email,
        emailVerifiedAt: users.emailVerifiedAt,
        handle: users.handle,
        createdAt: users.createdAt,
        profile: profiles,
        version: profileVersion,
      })
      .from(users)
      .innerJoin(profiles, eq(profiles.userId, users.id))
      .where(and(eq(users.id, userId), isNull(users.deletedAt)));
    // Access token válido de conta que deixou de existir.
    if (!row) throw new UnauthorizedException('Sessão inválida ou expirada');

    const me = meResponseSchema.parse({
      id: row.id,
      email: row.email,
      email_verified: row.emailVerifiedAt !== null,
      handle: row.handle,
      created_at: row.createdAt.toISOString(),
      profile: { ...toProfileFields(row.profile), updated_at: row.profile.updatedAt.toISOString() },
    });
    return { me, etag: `"${row.version}"` };
  }

  /**
   * Edição parcial com concorrência otimista: `ifMatch` precisa ser o ETag atual
   * do perfil, senão 409 — outra aba ou dispositivo salvou no meio do caminho.
   */
  async updateProfile(
    userId: string,
    patch: UpdateProfileInput,
    ifMatch: string | undefined,
    meta: RequestMeta,
  ): Promise<MeWithEtag> {
    if (!ifMatch) {
      throw new ProblemException({
        status: HttpStatus.PRECONDITION_REQUIRED,
        detail: 'Envie em If-Match o ETag recebido em GET /me.',
      });
    }

    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ profile: profiles, version: profileVersion })
        .from(profiles)
        .where(eq(profiles.userId, userId))
        .for('update');
      if (!current) throw new UnauthorizedException('Sessão inválida ou expirada');

      if (ifMatch !== '*' && ifMatch !== `"${current.version}"`) {
        throw new ProblemException({
          status: HttpStatus.CONFLICT,
          type: PROBLEM_TYPES.conflict,
          title: 'Perfil alterado em outro lugar',
          detail: 'O perfil mudou desde que foi carregado. Recarregue e aplique a edição de novo.',
        });
      }

      const changes: Partial<typeof profiles.$inferInsert> = {};
      const fields: string[] = [];
      for (const [field, column] of Object.entries(PROFILE_COLUMNS)) {
        const value = patch[field as keyof UpdateProfileInput];
        if (value === undefined || isDeepStrictEqual(value, current.profile[column])) continue;
        Object.assign(changes, { [column]: value });
        fields.push(field);
      }

      if (fields.length > 0) {
        if (changes.avatarMediaId) await this.assertOwnImage(tx, userId, changes.avatarMediaId);

        await tx
          .update(profiles)
          // clock_timestamp(): `now()` é o início da transação e poderia repetir o ETag.
          .set({ ...changes, updatedAt: sql`clock_timestamp()` })
          .where(eq(profiles.userId, userId));
        await this.audit.record(
          {
            action: 'profile.updated',
            entity: 'user',
            entityId: userId,
            userId,
            // Só os nomes dos campos: valores de perfil não vão para a auditoria.
            metadata: { ip: meta.ip, user_agent: meta.userAgent, fields },
          },
          tx,
        );
      }

      return this.getMe(userId, tx);
    });
  }

  /**
   * Troca o handle, no máximo uma vez a cada 30 dias. O handle antigo entra em
   * quarentena, reservado ao próprio usuário, que pode voltar a ele a qualquer hora.
   */
  async changeHandle(userId: string, handle: string, meta: RequestMeta): Promise<MeWithEtag> {
    try {
      return await this.db.transaction(async (tx) => {
        // Lock no usuário: duas trocas concorrentes não passam juntas pela regra dos 30 dias.
        const [user] = await tx
          .select({ handle: users.handle })
          .from(users)
          .where(and(eq(users.id, userId), isNull(users.deletedAt)))
          .for('update');
        if (!user) throw new UnauthorizedException('Sessão inválida ou expirada');
        if (user.handle === handle) return this.getMe(userId, tx);

        await tx
          .update(users)
          .set({ handle, updatedAt: sql`now()` })
          .where(eq(users.id, userId));
        // Depois do UPDATE (ver `claim`). Voltar ao próprio handle em quarentena
        // desfaz a troca anterior, então não passa pela espera dos 30 dias.
        const reverting = await this.handleReservations.claim(tx, handle, userId);
        if (!reverting) await this.assertHandleChangeAllowed(tx, userId);
        await this.handleReservations.reserve(tx, user.handle, userId);

        await this.audit.record(
          {
            action: 'profile.handle_changed',
            entity: 'user',
            entityId: userId,
            userId,
            metadata: {
              ip: meta.ip,
              user_agent: meta.userAgent,
              from: user.handle,
              to: handle,
              ...(reverting && { reverted: true }),
            },
          },
          tx,
        );
        return this.getMe(userId, tx);
      });
    } catch (error) {
      const pg = pgError(error);
      if (pg?.code !== PG_UNIQUE_VIOLATION || pg.constraint !== 'users_handle_unique') throw error;

      throw new ProblemException({
        status: HttpStatus.CONFLICT,
        type: PROBLEM_TYPES.conflict,
        title: 'Handle em uso',
        detail: 'Este handle já está em uso.',
        errors: [{ pointer: '/handle', detail: 'Este handle já está em uso.' }],
      });
    }
  }

  private async assertHandleChangeAllowed(tx: Transaction, userId: string): Promise<void> {
    const [last] = await tx
      .select({ createdAt: auditLog.createdAt })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entity, 'user'),
          eq(auditLog.entityId, userId),
          eq(auditLog.action, 'profile.handle_changed'),
        ),
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(1);
    const allowedAt = last && new Date(last.createdAt.getTime() + HANDLE_CHANGE_COOLDOWN_MS);
    if (!allowedAt || allowedAt <= new Date()) return;

    throw new ProblemException({
      status: HttpStatus.CONFLICT,
      type: PROBLEM_TYPES.handleChangeTooSoon,
      title: 'Troca de handle em espera',
      detail: `O handle só pode ser trocado a cada ${String(HANDLE_CHANGE_COOLDOWN_DAYS)} dias. Próxima troca a partir de ${allowedAt.toISOString()}.`,
    });
  }

  /** `userId` é quem pergunta, quando autenticado: a própria quarentena não o bloqueia. */
  async handleAvailability(rawHandle: string, userId?: string): Promise<HandleAvailability> {
    const handle = normalizeHandle(rawHandle);
    const problem = handleProblem(handle);
    if (problem) return handleAvailabilitySchema.parse({ available: false, reason: problem });
    if (await this.handleReservations.isReservedForOthers(handle, userId)) {
      return handleAvailabilitySchema.parse({ available: false, reason: 'reserved' });
    }

    // Conta soft-deleted também ocupa o handle: a constraint única é global.
    const [taken] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.handle, handle));
    return handleAvailabilitySchema.parse(
      taken ? { available: false, reason: 'taken' } : { available: true },
    );
  }

  async getPublicProfile(rawHandle: string): Promise<PublicProfileResponse> {
    const handle = normalizeHandle(rawHandle);
    const [row] = handleProblem(handle)
      ? []
      : await this.db
          .select({ handle: users.handle, profile: profiles })
          .from(users)
          .innerJoin(profiles, eq(profiles.userId, users.id))
          .where(and(eq(users.handle, handle), isNull(users.deletedAt)));
    if (!row) throw new NotFoundException('Perfil não encontrado');

    return publicProfileResponseSchema.parse({
      handle: row.handle,
      ...toProfileFields(row.profile),
    });
  }

  /** O avatar só pode apontar para uma imagem do próprio usuário (RNF-9). */
  private async assertOwnImage(executor: DbExecutor, userId: string, mediaId: string) {
    const [media] = await executor
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.id, mediaId),
          eq(mediaAssets.userId, userId),
          eq(mediaAssets.kind, 'image'),
          isNull(mediaAssets.deletedAt),
        ),
      );
    if (media) return;

    throw new ProblemException({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      type: PROBLEM_TYPES.validation,
      title: 'Requisição inválida',
      detail: 'Um ou mais campos não passaram na validação.',
      errors: [{ pointer: '/avatar_media_id', detail: 'Imagem não encontrada na sua biblioteca.' }],
    });
  }
}

function toProfileFields(profile: typeof profiles.$inferSelect) {
  return {
    display_name: profile.displayName,
    bio: profile.bio,
    location: profile.location,
    avatar_media_id: profile.avatarMediaId,
    roles: profile.roles,
    links: profile.links,
    theme: profile.theme,
  };
}
