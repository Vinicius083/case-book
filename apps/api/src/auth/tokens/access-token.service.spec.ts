import { randomUUID } from 'node:crypto';

import { decodeJwt, decodeProtectedHeader, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import {
  ACCESS_TOKEN_TTL_SEC,
  AccessTokenService,
  InvalidAccessTokenError,
} from './access-token.service.js';

const SECRET = 'unit-test-secret-unit-test-secret-unit-test';
const key = (secret: string) => new TextEncoder().encode(secret);
const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('AccessTokenService', () => {
  const service = new AccessTokenService({ JWT_ACCESS_SECRET: SECRET });
  const user = { id: randomUUID(), familyId: randomUUID() };

  it('assina HS256 com sub, sid, iat e exp de 15 minutos', async () => {
    const token = await service.sign(user);

    expect(decodeProtectedHeader(token)).toEqual({ alg: 'HS256', typ: 'JWT' });
    const claims = decodeJwt(token);
    expect(claims).toEqual({
      sub: user.id,
      sid: user.familyId,
      iat: expect.any(Number) as unknown,
      exp: expect.any(Number) as unknown,
    });
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(ACCESS_TOKEN_TTL_SEC);
  });

  it('verify devolve o usuário de um token válido', async () => {
    expect(await service.verify(await service.sign(user))).toEqual(user);
  });

  it('rejeita token expirado', async () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = await new SignJWT({ sid: user.familyId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuedAt(now - 3600)
      .setExpirationTime(now - 60)
      .sign(key(SECRET));

    await expect(service.verify(expired)).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it('rejeita assinatura feita com outro segredo', async () => {
    const forged = await new SignJWT({ sid: user.familyId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(key('outro-segredo-outro-segredo-outro-segredo'));

    await expect(service.verify(forged)).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it('rejeita payload adulterado com a assinatura original', async () => {
    const [header = '', , signature = ''] = (await service.sign(user)).split('.');
    const now = Math.floor(Date.now() / 1000);
    const payload = base64url({ sub: randomUUID(), sid: user.familyId, iat: now, exp: now + 900 });

    await expect(service.verify(`${header}.${payload}.${signature}`)).rejects.toBeInstanceOf(
      InvalidAccessTokenError,
    );
  });

  it('rejeita alg: none', async () => {
    const now = Math.floor(Date.now() / 1000);
    const header = base64url({ alg: 'none', typ: 'JWT' });
    const payload = base64url({ sub: user.id, sid: user.familyId, iat: now, exp: now + 900 });

    await expect(service.verify(`${header}.${payload}.`)).rejects.toBeInstanceOf(
      InvalidAccessTokenError,
    );
  });

  it('rejeita outro algoritmo mesmo com o segredo certo (HS512)', async () => {
    const hs512 = await new SignJWT({ sid: user.familyId })
      .setProtectedHeader({ alg: 'HS512' })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(key(SECRET.repeat(2)));

    await expect(service.verify(hs512)).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it('rejeita token sem a claim sid', async () => {
    const noSid = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(key(SECRET));

    await expect(service.verify(noSid)).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it('rejeita string que não é JWT', async () => {
    await expect(service.verify('não-é-um-jwt')).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });
});
