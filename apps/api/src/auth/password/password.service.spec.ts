import { beforeAll, describe, expect, it } from 'vitest';

import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
  const service = new PasswordService();
  const password = 'correct horse battery staple';
  let stored: string;

  beforeAll(async () => {
    await service.onModuleInit();
    stored = await service.hash(password);
  });

  it('gera hash argon2id com memoryCost 65536, timeCost 3 e parallelism 1', () => {
    expect(stored).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
    expect(stored).not.toContain(password);
  });

  it('usa salt aleatório: a mesma senha gera hashes diferentes', async () => {
    expect(await service.hash(password)).not.toBe(stored);
  });

  it('aceita a senha correta', async () => {
    expect(await service.verify(stored, password)).toBe(true);
  });

  it('rejeita senha errada', async () => {
    expect(await service.verify(stored, `${password}!`)).toBe(false);
  });

  it('sem hash armazenado (conta inexistente) devolve false para qualquer senha', async () => {
    expect(await service.verify(null, password)).toBe(false);
  });

  it('hash armazenado malformado devolve false em vez de lançar', async () => {
    expect(await service.verify('não é um hash', password)).toBe(false);
  });
});
