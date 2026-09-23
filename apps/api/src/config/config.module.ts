import { Global, Module } from '@nestjs/common';

import { parseEnv } from '@casebook/contracts';

import { apiEnvSchema, ENV } from './env.js';

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => parseEnv(apiEnvSchema) }],
  exports: [ENV],
})
export class ConfigModule {}
