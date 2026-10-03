import { Inject, Injectable, Logger } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
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
  private readonly logger = new Logger(SessionDenylist.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async deny(familyIds: readonly string[]): Promise<void> {
    if (familyIds.length === 0) return;
    const pipeline = this.redis.pipeline();
    for (const familyId of familyIds) pipeline.set(key(familyId), '1', 'EX', ACCESS_TOKEN_TTL_SEC);
    await pipeline.exec();
  }

  /**
   * Com o Redis fora, responde "não revogada" (fail-open) em vez de derrubar toda
   * rota autenticada: o RNF-6 pede que o upload siga funcionando numa queda do
   * Redis, e o outbox só serve se o `complete` chegar ao banco. A janela é a
   * validade do access token (15 min) e só vale para sessões revogadas durante a
   * queda; a assinatura e o `exp` do JWT continuam sendo checados.
   */
  async isDenied(familyId: string): Promise<boolean> {
    try {
      return (await this.redis.exists(key(familyId))) === 1;
    } catch (err) {
      this.logger.warn(`denylist indisponível, sessão aceita sem checagem: ${String(err)}`);
      trace.getActiveSpan()?.addEvent('session_denylist.unavailable');
      return false;
    }
  }
}

function key(familyId: string): string {
  return `deny:sid:${familyId}`;
}
