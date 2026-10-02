import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';

import { REDIS } from '../redis/redis.module.js';

export interface RateLimitResult {
  allowed: boolean;
  /** Segundos até a próxima tentativa caber na janela. 0 quando `allowed`. */
  retryAfterSec: number;
}

@Injectable()
export class RateLimitService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /**
   * Janela deslizante em sorted set (Redis db 1): cada tentativa é um membro com
   * score = timestamp. Tentativa recusada não ocupa lugar na janela, então quem
   * insiste durante o bloqueio não o prolonga.
   */
  async consume(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
    const redisKey = `rl:${key}`;
    const windowMs = windowSec * 1000;
    const now = Date.now();
    const member = `${String(now)}:${randomUUID()}`;

    const results = await this.redis
      .multi()
      .zremrangebyscore(redisKey, 0, now - windowMs)
      .zadd(redisKey, now, member)
      .zcard(redisKey)
      .pexpire(redisKey, windowMs)
      .exec();
    const count = Number(replyAt(results, 2));

    if (count <= limit) return { allowed: true, retryAfterSec: 0 };

    const after = await this.redis
      .multi()
      .zrem(redisKey, member)
      .zrangebyscore(redisKey, '-inf', '+inf', 'WITHSCORES', 'LIMIT', 0, 1)
      .exec();
    return blocked(replyAt(after, 1), now, windowMs);
  }

  /**
   * Só consulta: bloqueia quando a janela já tem `limit` registros, sem contar a
   * requisição atual. Par de `record`/`reset`, para limites em que o handler
   * decide o que conta (ex.: só logins que falharam).
   */
  async peek(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
    const redisKey = `rl:${key}`;
    const windowMs = windowSec * 1000;
    const now = Date.now();

    const results = await this.redis
      .multi()
      .zremrangebyscore(redisKey, 0, now - windowMs)
      .zcard(redisKey)
      .zrangebyscore(redisKey, '-inf', '+inf', 'WITHSCORES', 'LIMIT', 0, 1)
      .exec();

    if (Number(replyAt(results, 1)) < limit) return { allowed: true, retryAfterSec: 0 };
    return blocked(replyAt(results, 2), now, windowMs);
  }

  /** Registra uma ocorrência na janela da chave, sem checar limite. */
  async record(key: string, windowSec: number): Promise<void> {
    const redisKey = `rl:${key}`;
    const now = Date.now();
    const results = await this.redis
      .multi()
      .zadd(redisKey, now, `${String(now)}:${randomUUID()}`)
      .pexpire(redisKey, windowSec * 1000)
      .exec();
    replyAt(results, 0);
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(`rl:${key}`);
  }
}

/** A vaga abre quando o registro mais antigo sair da janela. */
function blocked(oldestWithScore: unknown, now: number, windowMs: number): RateLimitResult {
  const oldest = Number((oldestWithScore as string[])[1] ?? now);
  return {
    allowed: false,
    retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
  };
}

/** Resposta do comando `index` de um `MULTI`; lança se a transação ou o comando falhou. */
function replyAt(results: [Error | null, unknown][] | null, index: number): unknown {
  const entry = results?.[index];
  if (!entry) throw new Error('Transação Redis do rate limit foi abortada');
  const [error, reply] = entry;
  if (error) throw error;
  return reply;
}
