import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';

import { Storage } from '@casebook/storage';

import { type ApiEnv, ENV } from '../config/env.js';

/**
 * Cliente do object storage (MinIO em dev, R2 em produção). Layout de chaves e
 * spans manuais ficam em `@casebook/storage`, compartilhado com o relay e o
 * worker de imagem.
 */
export const STORAGE = Symbol('STORAGE');

@Global()
@Module({
  providers: [{ provide: STORAGE, inject: [ENV], useFactory: (env: ApiEnv) => new Storage(env) }],
  exports: [STORAGE],
})
export class StorageModule implements OnApplicationShutdown {
  constructor(@Inject(STORAGE) private readonly storage: Storage) {}

  onApplicationShutdown(): void {
    this.storage.destroy();
  }
}
