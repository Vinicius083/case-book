import { HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';

import type { AuthToken, LoginInput, SignupInput } from '@casebook/contracts/auth';
import { type Database, profiles, users } from '@casebook/db';

import { AuditService } from '../audit/audit.service.js';
import { PG_UNIQUE_VIOLATION, pgError } from '../common/pg-errors.js';
import { PROBLEM_TYPES, ProblemException } from '../common/problem.exception.js';
import { DB } from '../database/database.module.js';

import { PasswordService } from './password/password.service.js';
import { hashEmail } from './rate-limit.keys.js';
import { ACCESS_TOKEN_TTL_SEC, AccessTokenService } from './tokens/access-token.service.js';
import { type IssuedRefreshToken, RefreshTokenService } from './tokens/refresh-token.service.js';

import type { AuthUser } from './auth.types.js';
import type { RequestMeta } from '../common/http/request-meta.js';

/** Par emitido por signup, login e refresh: o body da resposta e o valor do cookie. */
export interface Session {
  body: AuthToken;
  refreshToken: string;
}

// Constraint única violada → campo do signup que o cliente precisa trocar.
const SIGNUP_CONFLICTS: Record<string, { pointer: string; detail: string }> = {
  users_email_unique: { pointer: '/email', detail: 'Este email já está em uso.' },
  users_handle_unique: { pointer: '/handle', detail: 'Este handle já está em uso.' },
};

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly passwords: PasswordService,
    private readonly accessTokens: AccessTokenService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly audit: AuditService,
  ) {}

  async signup(input: SignupInput, meta: RequestMeta): Promise<Session> {
    const passwordHash = await this.passwords.hash(input.password);

    try {
      const issued = await this.db.transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({ email: input.email, handle: input.handle, passwordHash })
          .returning({ id: users.id });
        if (!user) throw new Error('INSERT em users não devolveu linha');

        await tx.insert(profiles).values({ userId: user.id, displayName: input.display_name });
        const token = await this.refreshTokens.issue({ userId: user.id }, meta, tx);
        await this.audit.record(sessionEvent('auth.signup', token, meta), tx);
        return token;
      });
      return await this.toSession(issued);
    } catch (error) {
      const pg = pgError(error);
      const conflict = pg?.code === PG_UNIQUE_VIOLATION && SIGNUP_CONFLICTS[pg.constraint ?? ''];
      if (!conflict) throw error;

      throw new ProblemException({
        status: HttpStatus.CONFLICT,
        type: PROBLEM_TYPES.conflict,
        title: 'Cadastro em conflito',
        detail: conflict.detail,
        errors: [conflict],
      });
    }
  }

  async login(input: LoginInput, meta: RequestMeta): Promise<Session> {
    const [user] = await this.db
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(and(eq(users.email, input.email), isNull(users.deletedAt)));

    // Sem usuário, o verify roda contra o hash dummy: mesmo custo, mesmo caminho.
    const valid = await this.passwords.verify(user?.passwordHash ?? null, input.password);
    if (!user || !valid) {
      await this.audit.record({
        action: 'auth.login_failed',
        entity: 'user',
        entityId: user?.id ?? null,
        userId: user?.id ?? null,
        // Nunca o email em claro: tentativas com email errado não viram lista de endereços.
        metadata: { ip: meta.ip, user_agent: meta.userAgent, email_sha256: hashEmail(input.email) },
      });
      // Mesma resposta para email inexistente e senha errada.
      throw new UnauthorizedException('Email ou senha inválidos');
    }

    const issued = await this.db.transaction(async (tx) => {
      const token = await this.refreshTokens.issue({ userId: user.id }, meta, tx);
      await this.audit.record(sessionEvent('auth.login', token, meta), tx);
      return token;
    });
    return this.toSession(issued);
  }

  async refresh(refreshToken: string | undefined, meta: RequestMeta): Promise<Session> {
    if (!refreshToken) throw new UnauthorizedException('Sessão inválida ou expirada');
    return this.toSession(await this.refreshTokens.rotate(refreshToken, meta));
  }

  /** Revoga a família do cookie apresentado. Idempotente: cookie ausente ou desconhecido não é erro. */
  async logout(refreshToken: string | undefined, meta: RequestMeta): Promise<void> {
    const owner = refreshToken && (await this.refreshTokens.findOwner(refreshToken));
    if (!owner) return;

    await this.db.transaction(async (tx) => {
      await this.refreshTokens.revokeFamily(tx, owner.familyId, 'logout');
      await this.audit.record(sessionEvent('auth.logout', owner, meta), tx);
    });
  }

  async logoutAll(user: AuthUser, meta: RequestMeta): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.refreshTokens.revokeAllForUser(tx, user.id, 'logout');
      await this.audit.record(
        sessionEvent('auth.logout_all', { userId: user.id, familyId: user.familyId }, meta),
        tx,
      );
    });
  }

  private async toSession(issued: IssuedRefreshToken): Promise<Session> {
    const accessToken = await this.accessTokens.sign({
      id: issued.userId,
      familyId: issued.familyId,
    });
    return {
      body: { access_token: accessToken, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL_SEC },
      refreshToken: issued.token,
    };
  }
}

function sessionEvent(
  action: string,
  session: { userId: string; familyId: string },
  meta: RequestMeta,
) {
  return {
    action,
    entity: 'user',
    entityId: session.userId,
    userId: session.userId,
    metadata: { ip: meta.ip, user_agent: meta.userAgent, family_id: session.familyId },
  };
}
