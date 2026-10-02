import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { parseEnv } from '@casebook/contracts';

import { AppModule } from './app.module.js';
import { apiEnvSchema } from './config/env.js';

/** Monta a aplicação (compartilhado entre main.ts e os testes de integração). */
export async function createApp(): Promise<NestFastifyApplication> {
  // Lido antes do Nest existir: `trustProxy` é opção do construtor do Fastify.
  const env = parseEnv(apiEnvSchema);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: env.TRUST_PROXY }),
  );

  app.enableShutdownHooks();
  app.enableCors({
    origin: env.WEB_URL,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
  // Sem prefixo global: o Caddy cuida do roteamento em produção.

  return app;
}
