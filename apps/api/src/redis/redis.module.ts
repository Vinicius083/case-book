import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
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
      useFactory: (env: ApiEnv): Redis =>
        new Redis(env.REDIS_URL, {
          db: 1,
          // Com o Redis fora, falha o comando após 1 tentativa de reconexão em vez
          // de segurar a requisição indefinidamente.
          maxRetriesPerRequest: 1,
        }),
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
