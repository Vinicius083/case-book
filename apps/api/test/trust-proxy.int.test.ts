import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AuthHarness, randomIp } from './auth.helpers.js';

describe('TRUST_PROXY=true', () => {
  let t: AuthHarness;

  beforeAll(async () => {
    vi.stubEnv('TRUST_PROXY', 'true');
    t = await AuthHarness.create();
  });

  afterAll(async () => {
    await t.close();
    vi.unstubAllEnvs();
  });

  it('o rate limit usa o IP de X-Forwarded-For, não o do proxy', async () => {
    const proxyIp = randomIp();
    const clientIp = randomIp();
    const body = { email: `ninguem@${t.runId}.test.local`, password: 'senha-errada-1234' };
    const attempt = (forwardedFor: string) =>
      t.post('/auth/login', { ip: proxyIp, headers: { 'x-forwarded-for': forwardedFor }, body });

    for (let i = 1; i <= 5; i++) {
      expect((await attempt(clientIp)).statusCode).toBe(401);
    }
    expect((await attempt(clientIp)).statusCode).toBe(429);
    // outro cliente atrás do mesmo proxy não herda o bloqueio
    expect((await attempt(randomIp())).statusCode).toBe(401);
  });
});
