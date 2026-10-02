import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';

import { type ApiEnv, ENV } from '../../config/env.js';

import type { AuthUser } from '../auth.types.js';

export const ACCESS_TOKEN_TTL_SEC = 15 * 60;

const ALGORITHM = 'HS256';
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/;

export class InvalidAccessTokenError extends Error {
  constructor(options?: ErrorOptions) {
    super('Access token inválido', options);
  }
}

/** Access token: JWT HS256 de 15 min com `sub` (user id) e `sid` (family id). */
@Injectable()
export class AccessTokenService {
  private readonly secret: Uint8Array;

  constructor(@Inject(ENV) env: Pick<ApiEnv, 'JWT_ACCESS_SECRET'>) {
    this.secret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
  }

  sign(user: AuthUser): Promise<string> {
    return new SignJWT({ sid: user.familyId })
      .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime(`${String(ACCESS_TOKEN_TTL_SEC)}s`)
      .sign(this.secret);
  }

  /** Lança `InvalidAccessTokenError` para token expirado, adulterado ou malformado. */
  async verify(token: string): Promise<AuthUser> {
    try {
      // `algorithms` fixa HS256: `alg: none` e qualquer outro algoritmo são recusados.
      const { payload } = await jwtVerify(token, this.secret, {
        algorithms: [ALGORITHM],
        requiredClaims: ['sub', 'sid', 'iat', 'exp'],
      });
      const { sub, sid } = payload;
      if (
        typeof sub !== 'string' ||
        typeof sid !== 'string' ||
        !UUID.test(sub) ||
        !UUID.test(sid)
      ) {
        throw new Error('claims sub/sid ausentes ou fora do formato');
      }
      return { id: sub, familyId: sid };
    } catch (error) {
      throw new InvalidAccessTokenError({ cause: error });
    }
  }
}
