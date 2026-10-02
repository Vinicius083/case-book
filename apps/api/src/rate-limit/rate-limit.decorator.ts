import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';

import { RateLimitGuard } from './rate-limit.guard.js';

import type { ModuleRef } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

/**
 * Deriva a chave do limite a partir da requisição. `undefined` pula a regra (ex.:
 * body sem email). O `moduleRef` dá acesso a providers quando a chave depende de
 * uma consulta.
 */
export type RateLimitKey = (
  request: FastifyRequest,
  moduleRef: ModuleRef,
) => string | undefined | Promise<string | undefined>;

export interface RateLimitRule {
  key: RateLimitKey;
  /** Tentativas permitidas dentro da janela. */
  limit: number;
  windowSec: number;
}

export const RATE_LIMIT_RULES = Symbol('RATE_LIMIT_RULES');

/**
 * Aplica um ou mais limites à rota, avaliados na ordem; o primeiro excedido
 * responde 429 com `Retry-After`.
 *
 *   @RateLimit({ key: byIp, limit: 5, windowSec: 3600 })
 */
export function RateLimit(...rules: RateLimitRule[]): MethodDecorator {
  return applyDecorators(SetMetadata(RATE_LIMIT_RULES, rules), UseGuards(RateLimitGuard));
}
