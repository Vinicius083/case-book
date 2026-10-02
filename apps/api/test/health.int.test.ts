import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.factory.js';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';

// Integração: aplicação Nest real contra o Postgres e o Redis do compose.
describe('GET /health', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('responde 200 com db e redis ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'ok',
      db: 'ok',
      redis: 'ok',
      uptime: expect.any(Number) as unknown,
    });
  });

  it('rota inexistente responde 404 em Problem Details', async () => {
    const res = await app.inject({ method: 'GET', url: '/nao-existe' });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({ status: 404, instance: '/nao-existe' });
  });
});
