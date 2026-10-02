import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ModuleRef, Reflector } from '@nestjs/core';

import { PROBLEM_TYPES, ProblemException } from '../common/problem.exception.js';

import { RATE_LIMIT_RULES, type RateLimitRule } from './rate-limit.decorator.js';
import { RateLimitService } from './rate-limit.service.js';

import type { FastifyRequest } from 'fastify';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly moduleRef: ModuleRef,
    private readonly rateLimit: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rules =
      this.reflector.get<RateLimitRule[] | undefined>(RATE_LIMIT_RULES, context.getHandler()) ?? [];
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    for (const rule of rules) {
      const key = await rule.key(request, this.moduleRef);
      if (key === undefined) continue;

      const { allowed, retryAfterSec } =
        rule.consume === false
          ? await this.rateLimit.peek(key, rule.limit, rule.windowSec)
          : await this.rateLimit.consume(key, rule.limit, rule.windowSec);
      if (!allowed) {
        throw new ProblemException({
          status: HttpStatus.TOO_MANY_REQUESTS,
          type: PROBLEM_TYPES.rateLimited,
          title: 'Muitas tentativas',
          detail: `Limite de requisições excedido. Tente de novo em ${String(retryAfterSec)}s.`,
          headers: { 'retry-after': String(retryAfterSec) },
        });
      }
    }
    return true;
  }
}
