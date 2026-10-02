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

/**
 * Marcador de sessão para o front: `cb_refresh` só é enviado a `/api/auth`, então
 * o middleware do Next não o enxerga nas rotas de página. Este cookie vai em
 * todo path, vive o mesmo tempo e não carrega segredo nenhum — só diz "pode
 * haver sessão", para decidir redirecionamentos. Não autoriza nada.
 */
export const SESSION_MARKER_COOKIE_NAME = 'cb_session';

/** Escreve o cookie `cb_refresh` (HttpOnly; Secure; SameSite=Lax) e o marcador de sessão. */
@Injectable()
export class RefreshCookie {
  // Só as rotas de auth recebem o refresh token; o resto da API nunca o vê.
  private readonly refreshAttributes: string;
  private readonly markerAttributes: string;

  constructor(@Inject(ENV) env: Pick<ApiEnv, 'AUTH_COOKIE_PATH' | 'AUTH_COOKIE_SECURE'>) {
    const flags = `HttpOnly; ${env.AUTH_COOKIE_SECURE ? 'Secure; ' : ''}SameSite=Lax`;
    this.refreshAttributes = `Path=${env.AUTH_COOKIE_PATH}; ${flags}`;
    this.markerAttributes = `Path=/; ${flags}`;
  }

  set(reply: FastifyReply, token: string): void {
    const maxAge = `Max-Age=${String(REFRESH_TOKEN_TTL_SEC)}`;
    void reply.header('set-cookie', [
      `${REFRESH_COOKIE_NAME}=${token}; ${maxAge}; ${this.refreshAttributes}`,
      `${SESSION_MARKER_COOKIE_NAME}=1; ${maxAge}; ${this.markerAttributes}`,
    ]);
  }

  clear(reply: FastifyReply): void {
    void reply.header('set-cookie', [
      `${REFRESH_COOKIE_NAME}=; Max-Age=0; ${this.refreshAttributes}`,
      `${SESSION_MARKER_COOKIE_NAME}=; Max-Age=0; ${this.markerAttributes}`,
    ]);
  }
}
