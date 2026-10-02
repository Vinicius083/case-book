import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';

import {
  type Database,
  type DbExecutor,
  refreshTokens,
  type RefreshTokenRevokedReason,
  type Transaction,
} from '@casebook/db';

import { AuditService } from '../../audit/audit.service.js';
import { DB } from '../../database/database.module.js';

import type { RequestMeta } from '../../common/http/request-meta.js';

export const REFRESH_TOKEN_TTL_SEC = 30 * 24 * 60 * 60;

/**
 * Janela em que um token já rotacionado ainda é aceito: duas abas que pedem
 * refresh ao mesmo tempo mandam o mesmo cookie, e a segunda não pode ser tratada
 * como roubo.
 */
export const ROTATION_GRACE_MS = 10_000;

export interface IssuedRefreshToken {
  /** Token opaco em claro: só existe aqui e no cookie. */
  token: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
}

interface IssueParams {
  userId: string;
  /** Omitido em login/signup: abre uma família nova. */
  familyId?: string;
  parentId?: string;
}

type RotateOutcome =
  | { kind: 'rotated'; issued: IssuedRefreshToken }
  | { kind: 'rejected'; reason: 'not_found' | 'revoked' | 'expired' | 'reuse_detected' };

@Injectable()
export class RefreshTokenService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** Emite um refresh token. No banco fica só o SHA-256. */
  async issue(
    params: IssueParams,
    meta: RequestMeta,
    executor: DbExecutor = this.db,
  ): Promise<IssuedRefreshToken> {
    const token = randomBytes(32).toString('base64url');
    const familyId = params.familyId ?? randomUUID();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SEC * 1000);

    await executor.insert(refreshTokens).values({
      userId: params.userId,
      familyId,
      parentId: params.parentId ?? null,
      tokenHash: hashToken(token),
      expiresAt,
      userAgent: meta.userAgent,
      ip: meta.ip,
    });

    return { token, userId: params.userId, familyId, expiresAt };
  }

  /**
   * Troca o token apresentado por um novo da mesma família. Reuso de token já
   * rotacionado (fora da janela de graça) revoga a família inteira. Qualquer
   * recusa vira o mesmo 401, sem dizer o motivo ao cliente.
   */
  async rotate(token: string, meta: RequestMeta): Promise<IssuedRefreshToken> {
    const tokenHash = hashToken(token);

    // O 401 só é lançado depois do commit: a revogação por reuso e o registro de
    // auditoria precisam persistir.
    const outcome = await this.db.transaction(async (tx): Promise<RotateOutcome> => {
      const familyId = await this.findFamilyId(token, tx);
      if (!familyId) return { kind: 'rejected', reason: 'not_found' };
      await lockFamily(tx, familyId);

      const [row] = await tx
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, tokenHash))
        .for('update');
      if (!row) return { kind: 'rejected', reason: 'not_found' };

      const now = new Date();
      if (row.revokedAt) return { kind: 'rejected', reason: 'revoked' };
      if (row.expiresAt <= now) {
        await tx
          .update(refreshTokens)
          .set({ revokedAt: now, revokedReason: 'expired' })
          .where(eq(refreshTokens.id, row.id));
        return { kind: 'rejected', reason: 'expired' };
      }

      if (row.rotatedAt) {
        if (now.getTime() - row.rotatedAt.getTime() >= ROTATION_GRACE_MS) {
          await this.revokeFamilyLocked(tx, row.familyId, 'reuse_detected');
          await this.audit.record(
            {
              action: 'auth.refresh_reuse_detected',
              entity: 'refresh_token_family',
              entityId: row.familyId,
              userId: row.userId,
              metadata: {
                ip: meta.ip,
                user_agent: meta.userAgent,
                family_id: row.familyId,
                token_id: row.id,
              },
            },
            tx,
          );
          return { kind: 'rejected', reason: 'reuse_detected' };
        }
        // Corrida entre abas: novo filho na mesma família, sem revogar nada.
      } else {
        await tx.update(refreshTokens).set({ rotatedAt: now }).where(eq(refreshTokens.id, row.id));
      }

      const issued = await this.issue(
        { userId: row.userId, familyId: row.familyId, parentId: row.id },
        meta,
        tx,
      );
      return { kind: 'rotated', issued };
    });

    if (outcome.kind === 'rejected') throw new UnauthorizedException('Sessão inválida ou expirada');
    return outcome.issued;
  }

  /** Família do token, exista ele em que estado for. `undefined` se desconhecido. */
  async findFamilyId(token: string, executor: DbExecutor = this.db): Promise<string | undefined> {
    const [row] = await executor
      .select({ familyId: refreshTokens.familyId })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hashToken(token)));
    return row?.familyId;
  }

  /** Dono e família do token, para o logout. `undefined` se desconhecido. */
  async findOwner(token: string): Promise<{ userId: string; familyId: string } | undefined> {
    const [row] = await this.db
      .select({ userId: refreshTokens.userId, familyId: refreshTokens.familyId })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hashToken(token)));
    return row;
  }

  /** Revoga todos os tokens ainda ativos da família. */
  async revokeFamily(
    tx: Transaction,
    familyId: string,
    reason: RefreshTokenRevokedReason,
  ): Promise<void> {
    await lockFamily(tx, familyId);
    await this.revokeFamilyLocked(tx, familyId, reason);
  }

  /** Revoga todas as famílias ativas do usuário. */
  async revokeAllForUser(
    tx: Transaction,
    userId: string,
    reason: RefreshTokenRevokedReason,
  ): Promise<void> {
    const families = await tx
      .selectDistinct({ familyId: refreshTokens.familyId })
      .from(refreshTokens)
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)))
      .orderBy(refreshTokens.familyId); // ordem fixa: sem deadlock entre chamadas concorrentes

    for (const { familyId } of families) {
      await this.revokeFamily(tx, familyId, reason);
    }
  }

  private async revokeFamilyLocked(
    tx: Transaction,
    familyId: string,
    reason: RefreshTokenRevokedReason,
  ): Promise<void> {
    await tx
      .update(refreshTokens)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }
}

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

/**
 * Serializa rotação e revogação da mesma família até o fim da transação. O
 * `FOR UPDATE` na linha do token não basta: uma revogação concorrente não enxerga
 * o filho que uma rotação em andamento ainda não commitou, e ele sobreviveria ao
 * logout. Sempre adquirido antes do lock de linha, para a ordem ser única.
 */
async function lockFamily(tx: Transaction, familyId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${familyId}, 0))`);
}
