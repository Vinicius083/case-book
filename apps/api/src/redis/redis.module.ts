import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';

import { type ApiEnv, ENV } from '../config/env.js';

/**
 * Conexão Redis de uso geral da API (cache, rate-limit, health).
 * Convenção de databases: 0 = filas (BullMQ, conexões próprias), 1 = cache.
 */
export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ENV],
      useFactory: (env: ApiEnv): Redis => {
        const redis = new Redis(env.REDIS_URL, {
          db: 1,
          // Com o Redis fora, falha o comando após 1 tentativa de reconexão em vez
          // de segurar a requisição indefinidamente.
          maxRetriesPerRequest: 1,
        });
        // Sem listener, o ioredis imprime "Unhandled error event" a cada tentativa
        // de reconexão. Loga só quando o erro muda; a reconexão é automática.
        const logger = new Logger('Redis');
        let last: string | undefined;
        redis.on('error', (err: Error) => {
          if (err.message !== last) logger.warn(`conexão com o Redis: ${err.message}`);
          last = err.message;
        });
        redis.on('ready', () => {
          if (last !== undefined) logger.log('conexão com o Redis restabelecida');
          last = undefined;
        });
        return redis;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit();
  }
}
