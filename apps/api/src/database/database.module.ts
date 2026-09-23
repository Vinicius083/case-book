import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';

import { createDb, type Database } from '@casebook/db';

import { type ApiEnv, ENV } from '../config/env.js';

export const DB = Symbol('DB');

@Global()
@Module({
  providers: [
    {
      provide: DB,
      inject: [ENV],
      useFactory: (env: ApiEnv): Database => createDb(env.DATABASE_URL),
    },
  ],
  exports: [DB],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: Database) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.$client.end();
  }
}
