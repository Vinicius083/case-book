import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';

import { REDIS } from '../../redis/redis.module.js';

import { ACCESS_TOKEN_TTL_SEC } from './access-token.service.js';

/**
 * Famílias cujo access token deixa de valer antes do `exp` (Redis db 1). Entram
 * aqui as revogações que não podem esperar os 15 min do JWT: reuso detectado,
 * troca de senha e logout-all. O TTL é a validade do access token — depois disso
 * não sobra nenhum token da família para barrar. Logout comum não entra.
 */
@Injectable()
export class SessionDenylist {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async deny(familyIds: readonly string[]): Promise<void> {
    if (familyIds.length === 0) return;
    const pipeline = this.redis.pipeline();
    for (const familyId of familyIds) pipeline.set(key(familyId), '1', 'EX', ACCESS_TOKEN_TTL_SEC);
    await pipeline.exec();
  }

  async isDenied(familyId: string): Promise<boolean> {
    return (await this.redis.exists(key(familyId))) === 1;
  }
}

function key(familyId: string): string {
  return `deny:sid:${familyId}`;
}
