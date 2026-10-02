import { createHash } from 'node:crypto';

import { readRefreshCookie } from './refresh-cookie.js';
import { RefreshTokenService } from './tokens/refresh-token.service.js';

import type { RateLimitKey } from '../rate-limit/rate-limit.decorator.js';

/** SHA-256 (hex) do email normalizado: chave de rate limit e auditoria sem email em claro. */
export function hashEmail(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

export const loginByIp: RateLimitKey = (request) => `login:ip:${request.ip}`;

/** Falhas de login toleradas por IP + email dentro da janela. */
export const LOGIN_FAILURES = { limit: 5, windowSec: 15 * 60 } as const;

/** Chave das falhas de login de um IP contra um email; zerada no login bem-sucedido. */
export function loginFailuresKey(ip: string, email: string): string {
  return `login:ip-email:${ip}:${hashEmail(email)}`;
}

// Guards rodam antes dos pipes: o body ainda não foi validado nem normalizado.
export const loginByIpAndEmail: RateLimitKey = (request) => {
  const { email } = (request.body ?? {}) as { email?: unknown };
  return typeof email === 'string' ? loginFailuresKey(request.ip, email) : undefined;
};

export const signupByIp: RateLimitKey = (request) => `signup:ip:${request.ip}`;

// Token desconhecido não tem família: sem chave, a rota responde 401 logo adiante.
export const refreshByFamily: RateLimitKey = async (request, moduleRef) => {
  const token = readRefreshCookie(request);
  if (!token) return undefined;
  const familyId = await moduleRef.get(RefreshTokenService, { strict: false }).findFamilyId(token);
  return familyId ? `refresh:family:${familyId}` : undefined;
};
