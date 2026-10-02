import type { RateLimitKey } from './rate-limit.decorator.js';

/** Limite por IP do cliente, isolado por `scope` (um nome por rota). */
export const byIp =
  (scope: string): RateLimitKey =>
  (request) =>
    `${scope}:ip:${request.ip}`;

/** Limite por usuário autenticado. Sem usuário (rota pública) a regra é pulada. */
export const byUser =
  (scope: string): RateLimitKey =>
  (request) =>
    request.user ? `${scope}:user:${request.user.id}` : undefined;
