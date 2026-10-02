import { createHash } from 'node:crypto';

import { readRefreshCookie } from './refresh-cookie.js';
import { RefreshTokenService } from './tokens/refresh-token.service.js';

import type { RateLimitKey } from '../rate-limit/rate-limit.decorator.js';

/** SHA-256 (hex) do email normalizado: chave de rate limit e auditoria sem email em claro. */
export function hashEmail(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

export const loginByIp: RateLimitKey = (request) => `login:ip:${request.ip}`;

// Guards rodam antes dos pipes: o body ainda não foi validado nem normalizado.
export const loginByIpAndEmail: RateLimitKey = (request) => {
  const { email } = (request.body ?? {}) as { email?: unknown };
  if (typeof email !== 'string') return undefined;
  return `login:ip-email:${request.ip}:${hashEmail(email)}`;
};

export const signupByIp: RateLimitKey = (request) => `signup:ip:${request.ip}`;

// Token desconhecido não tem família: sem chave, a rota responde 401 logo adiante.
export const refreshByFamily: RateLimitKey = async (request, moduleRef) => {
  const token = readRefreshCookie(request);
  if (!token) return undefined;
  const familyId = await moduleRef.get(RefreshTokenService, { strict: false }).findFamilyId(token);
  return familyId ? `refresh:family:${familyId}` : undefined;
};
