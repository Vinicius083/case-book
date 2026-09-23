import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module.js';
import { type ApiEnv, ENV } from './config/env.js';

/** Monta a aplicação (compartilhado entre main.ts e os testes de integração). */
export async function createApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  const env = app.get<ApiEnv>(ENV);

  app.enableShutdownHooks();
  app.enableCors({
    origin: env.WEB_URL,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
  // Sem prefixo global: o Caddy cuida do roteamento em produção.

  return app;
}
