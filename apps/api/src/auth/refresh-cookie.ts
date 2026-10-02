import { Inject, Injectable } from '@nestjs/common';

import { type ApiEnv, ENV } from '../config/env.js';

import { REFRESH_TOKEN_TTL_SEC } from './tokens/refresh-token.service.js';

import type { FastifyReply, FastifyRequest } from 'fastify';

export const REFRESH_COOKIE_NAME = 'cb_refresh';

/**
 * Valor do cookie `cb_refresh` no header `Cookie`. O token é base64url, então não
 * há aspas nem percent-encoding para desfazer.
 */
export function readRefreshCookie(request: FastifyRequest): string | undefined {
  for (const pair of (request.headers.cookie ?? '').split(';')) {
    const separator = pair.indexOf('=');
    if (separator !== -1 && pair.slice(0, separator).trim() === REFRESH_COOKIE_NAME) {
      return pair.slice(separator + 1).trim() || undefined;
    }
  }
  return undefined;
}

/** Escreve o cookie `cb_refresh` (HttpOnly; Secure; SameSite=Lax). */
@Injectable()
export class RefreshCookie {
  // Só as rotas de auth recebem o cookie; o resto da API nunca o vê.
  private readonly attributes: string;

  constructor(@Inject(ENV) env: Pick<ApiEnv, 'AUTH_COOKIE_PATH'>) {
    this.attributes = `Path=${env.AUTH_COOKIE_PATH}; HttpOnly; Secure; SameSite=Lax`;
  }

  set(reply: FastifyReply, token: string): void {
    void reply.header(
      'set-cookie',
      `${REFRESH_COOKIE_NAME}=${token}; Max-Age=${String(REFRESH_TOKEN_TTL_SEC)}; ${this.attributes}`,
    );
  }

  clear(reply: FastifyReply): void {
    void reply.header('set-cookie', `${REFRESH_COOKIE_NAME}=; Max-Age=0; ${this.attributes}`);
  }
}
