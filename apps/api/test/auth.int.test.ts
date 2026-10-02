import { and, asc, eq, sql } from 'drizzle-orm';
import { decodeJwt } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { auditLog, profiles, refreshTokens, users } from '@casebook/db';

import {
  AuthHarness,
  PASSWORD,
  randomIp,
  refreshCookie,
  setCookieHeader,
  sha256,
} from './auth.helpers.js';

// Integração: aplicação Nest real contra o Postgres e o Redis do compose.
describe('auth', () => {
  let t: AuthHarness;

  beforeAll(async () => {
    t = await AuthHarness.create();
  });

  afterAll(async () => {
    await t.close();
  });

  const familyTokens = (familyId: string) =>
    t.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.familyId, familyId))
      .orderBy(asc(refreshTokens.createdAt));

  const auditActions = async (userId: string) => {
    const rows = await t.db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.userId, userId))
      .orderBy(asc(auditLog.id));
    return rows.map((row) => row.action);
  };

  describe('fluxo signup → login → refresh → logout', () => {
    it('emite, rotaciona e revoga a sessão, conferindo o cookie em cada passo', async () => {
      const user = t.newUser();
      const cookieAttributes = new RegExp(
        `^cb_refresh=[\\w-]{43}; Max-Age=2592000; Path=${t.env.AUTH_COOKIE_PATH}; HttpOnly; Secure; SameSite=Lax$`,
      );

      // signup
      const signup = await t.post('/auth/signup', {
        body: { ...user, email: `  ${user.email.toUpperCase()} `, display_name: ' Ana Lima ' },
      });
      expect(signup.statusCode).toBe(201);
      expect(signup.json()).toEqual({
        access_token: expect.any(String) as unknown,
        token_type: 'Bearer',
        expires_in: 900,
      });
      expect(signup.headers['cache-control']).toBe('no-store');
      expect(setCookieHeader(signup)).toMatch(cookieAttributes);

      const userId = await t.userId(user.email); // email gravado já normalizado
      const [profile] = await t.db.select().from(profiles).where(eq(profiles.userId, userId));
      expect(profile?.displayName).toBe('Ana Lima');
      const [row] = await t.db.select().from(users).where(eq(users.id, userId));
      expect(row?.passwordHash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);

      // login: sessão (família) nova
      const login = await t.post('/auth/login', {
        body: { email: user.email, password: user.password },
      });
      expect(login.statusCode).toBe(200);
      expect(setCookieHeader(login)).toMatch(cookieAttributes);
      const loginToken = refreshCookie(login);
      expect(loginToken).not.toBe(refreshCookie(signup));

      const claims = decodeJwt(login.json<{ access_token: string }>().access_token);
      expect(claims.sub).toBe(userId);
      const familyId = claims['sid'] as string;

      // no banco fica só o SHA-256 do token
      const [stored] = await familyTokens(familyId);
      expect(stored?.tokenHash.equals(sha256(loginToken))).toBe(true);

      // refresh: cookie novo, mesma família
      const refresh = await t.post('/auth/refresh', { cookie: loginToken });
      expect(refresh.statusCode).toBe(200);
      expect(setCookieHeader(refresh)).toMatch(cookieAttributes);
      const rotatedToken = refreshCookie(refresh);
      expect(rotatedToken).not.toBe(loginToken);
      expect(decodeJwt(refresh.json<{ access_token: string }>().access_token)['sid']).toBe(
        familyId,
      );

      const [parent, child] = await familyTokens(familyId);
      expect(parent?.rotatedAt).toBeInstanceOf(Date);
      expect(child).toMatchObject({ parentId: parent?.id, rotatedAt: null, revokedAt: null });

      // logout: revoga a família e limpa o cookie
      const logout = await t.post('/auth/logout', { cookie: rotatedToken });
      expect(logout.statusCode).toBe(204);
      expect(setCookieHeader(logout)).toBe(
        `cb_refresh=; Max-Age=0; Path=${t.env.AUTH_COOKIE_PATH}; HttpOnly; Secure; SameSite=Lax`,
      );
      for (const token of await familyTokens(familyId)) {
        expect(token).toMatchObject({
          revokedAt: expect.any(Date) as unknown,
          revokedReason: 'logout',
        });
      }

      // depois do logout o refresh não vale mais (e o cookie é limpo de novo)
      const afterLogout = await t.post('/auth/refresh', { cookie: rotatedToken });
      expect(afterLogout.statusCode).toBe(401);
      expect(afterLogout.headers['content-type']).toContain('application/problem+json');
      expect(setCookieHeader(afterLogout)).toContain('Max-Age=0');

      expect(await auditActions(userId)).toEqual(['auth.signup', 'auth.login', 'auth.logout']);
    });

    it('logout sem cookie ou com cookie desconhecido responde 204', async () => {
      expect((await t.post('/auth/logout')).statusCode).toBe(204);
      expect((await t.post('/auth/logout', { cookie: 'token-desconhecido' })).statusCode).toBe(204);
    });

    it('refresh sem cookie ou com token desconhecido responde 401', async () => {
      expect((await t.post('/auth/refresh')).statusCode).toBe(401);
      expect((await t.post('/auth/refresh', { cookie: 'token-desconhecido' })).statusCode).toBe(
        401,
      );
    });

    it('refresh com token expirado responde 401', async () => {
      const { refreshToken } = await t.signup();
      await t.db
        .update(refreshTokens)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(refreshTokens.tokenHash, sha256(refreshToken)));

      expect((await t.post('/auth/refresh', { cookie: refreshToken })).statusCode).toBe(401);
    });
  });

  describe('signup', () => {
    it('email ou handle já usados → 409 indicando o campo', async () => {
      const { user } = await t.signup();
      const other = t.newUser();

      const sameEmail = await t.post('/auth/signup', {
        body: { ...other, email: user.email.toUpperCase(), display_name: 'Outra' },
      });
      expect(sameEmail.statusCode).toBe(409);
      expect(sameEmail.headers['content-type']).toContain('application/problem+json');
      expect(sameEmail.json()).toMatchObject({
        type: 'urn:casebook:problem:conflict',
        status: 409,
        errors: [{ pointer: '/email', detail: expect.any(String) as unknown }],
      });

      const sameHandle = await t.post('/auth/signup', {
        body: { ...other, handle: user.handle, display_name: 'Outra' },
      });
      expect(sameHandle.statusCode).toBe(409);
      expect(sameHandle.json()).toMatchObject({ errors: [{ pointer: '/handle' }] });

      // a transação do signup recusado não deixa usuário nem sessão para trás
      const leftovers = await t.db.select().from(users).where(eq(users.email, other.email));
      expect(leftovers).toHaveLength(0);
    });

    it('body inválido → 422 com erros por campo, sem ecoar a senha', async () => {
      const res = await t.post('/auth/signup', {
        body: { email: 'não-é-email', password: 'curta', handle: '-x', display_name: '' },
      });

      expect(res.statusCode).toBe(422);
      const pointers = res.json<{ errors: { pointer: string }[] }>().errors.map((e) => e.pointer);
      expect(pointers.sort()).toEqual(['/display_name', '/email', '/handle', '/password']);
      expect(res.body).not.toContain('curta');
    });

    it('6º signup do mesmo IP em 1 hora → 429, antes de qualquer checagem de conflito', async () => {
      const ip = randomIp();
      const { user } = await t.signup();
      const duplicate = { ...user, display_name: 'Duplicado' };

      for (let attempt = 1; attempt <= 5; attempt++) {
        expect((await t.post('/auth/signup', { ip, body: duplicate })).statusCode).toBe(409);
      }
      const blocked = await t.post('/auth/signup', { ip, body: duplicate });
      expect(blocked.statusCode).toBe(429);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(3500);
    });
  });

  describe('login', () => {
    it('email inexistente e senha errada têm a mesma resposta 401', async () => {
      const { user } = await t.signup();

      const wrongPassword = await t.post('/auth/login', {
        body: { email: user.email, password: 'senha-errada-1234' },
      });
      const unknownEmail = await t.post('/auth/login', {
        body: { email: `nao-existe@${t.runId}.test.local`, password: PASSWORD },
      });

      expect(wrongPassword.statusCode).toBe(401);
      expect(unknownEmail.statusCode).toBe(401);
      const comparable = (body: Record<string, unknown>) => ({ ...body, trace_id: undefined });
      expect(comparable(wrongPassword.json())).toEqual(comparable(unknownEmail.json()));
      expect(wrongPassword.headers['set-cookie']).toBeUndefined();
    });

    it('auditoria de login_failed guarda o SHA-256 do email, nunca o email em claro', async () => {
      const email = `Ghost@${t.runId}.test.local`;
      await t.post('/auth/login', { body: { email, password: PASSWORD } });

      const emailHash = sha256(email.toLowerCase()).toString('hex');
      const [entry] = await t.db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, 'auth.login_failed'),
            sql`${auditLog.metadata}->>'email_sha256' = ${emailHash}`,
          ),
        );

      expect(entry).toMatchObject({ userId: null, entity: 'user' });
      expect(entry?.metadata).toEqual({
        ip: expect.stringMatching(/^10\./) as unknown,
        user_agent: t.userAgent,
        email_sha256: emailHash,
      });
      expect(JSON.stringify(entry).toLowerCase()).not.toContain('ghost@');
    });

    it('6º login errado em 15 min → 429 com Retry-After', async () => {
      const { user } = await t.signup();
      const ip = randomIp();
      const attempt = (password: string) =>
        t.post('/auth/login', { ip, body: { email: user.email, password } });

      for (let i = 1; i <= 5; i++) {
        expect((await attempt('senha-errada-1234')).statusCode).toBe(401);
      }

      const blocked = await attempt('senha-errada-1234');
      expect(blocked.statusCode).toBe(429);
      expect(blocked.headers['content-type']).toContain('application/problem+json');
      expect(blocked.json()).toMatchObject({
        type: 'urn:casebook:problem:rate-limited',
        status: 429,
        trace_id: expect.any(String) as unknown,
      });
      const retryAfter = Number(blocked.headers['retry-after']);
      expect(retryAfter).toBeGreaterThan(890);
      expect(retryAfter).toBeLessThanOrEqual(900);

      // bloqueado, nem a senha certa passa; de outro IP o mesmo email segue livre
      expect((await attempt(user.password)).statusCode).toBe(429);
      const elsewhere = await t.post('/auth/login', {
        body: { email: user.email, password: user.password },
      });
      expect(elsewhere.statusCode).toBe(200);
    });

    it('6 logins corretos seguidos → todos 200: só falha conta no limite por IP + email', async () => {
      const { user } = await t.signup();
      const ip = randomIp();

      for (let i = 1; i <= 6; i++) {
        const res = await t.post('/auth/login', {
          ip,
          body: { email: user.email, password: user.password },
        });
        expect(res.statusCode).toBe(200);
      }
    });

    it('login bem-sucedido zera as falhas acumuladas', async () => {
      const { user } = await t.signup();
      const ip = randomIp();
      const attempt = (password: string) =>
        t.post('/auth/login', { ip, body: { email: user.email, password } });

      for (let i = 1; i <= 4; i++) await attempt('senha-errada-1234');
      expect((await attempt(user.password)).statusCode).toBe(200);

      // sem o reset, a 2ª falha abaixo já seria a 6ª da janela
      for (let i = 1; i <= 5; i++) {
        expect((await attempt('senha-errada-1234')).statusCode).toBe(401);
      }
      expect((await attempt('senha-errada-1234')).statusCode).toBe(429);
    });

    it('X-Forwarded-For é ignorado sem TRUST_PROXY: não serve para escapar do limite', async () => {
      const { user } = await t.signup();
      const ip = randomIp();
      const attempt = () =>
        t.post('/auth/login', {
          ip,
          headers: { 'x-forwarded-for': randomIp() },
          body: { email: user.email, password: 'senha-errada-1234' },
        });

      for (let i = 1; i <= 5; i++) await attempt();
      expect((await attempt()).statusCode).toBe(429);
    });

    it('tempo de resposta: email inexistente vs senha errada difere menos de 20% na média', async () => {
      const { user } = await t.signup();
      const time = async (email: string) => {
        const start = performance.now();
        const res = await t.post('/auth/login', { body: { email, password: 'senha-errada-1234' } });
        expect(res.statusCode).toBe(401);
        return performance.now() - start;
      };
      const unknown = () => time(`ninguem-${String(Math.random()).slice(2)}@${t.runId}.test.local`);
      const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

      await time(user.email); // aquecimento
      await unknown();

      const wrongPassword: number[] = [];
      const unknownEmail: number[] = [];
      // Intercalado: variação de carga da máquina afeta os dois grupos por igual.
      for (let i = 0; i < 20; i++) {
        wrongPassword.push(await time(user.email));
        unknownEmail.push(await unknown());
      }

      const [a, b] = [mean(wrongPassword), mean(unknownEmail)];
      expect(Math.abs(a - b) / Math.max(a, b)).toBeLessThan(0.2);
    }, 60_000);
  });

  describe('rotação e reuso de refresh token', () => {
    it('reuso de token rotacionado há mais de 10s revoga a família; o token legítimo também cai', async () => {
      const stolen = await t.signup();
      const userId = await t.userId(stolen.user.email);

      // o usuário legítimo rotaciona: `stolen.refreshToken` passa a ser um token antigo
      const legit = await t.post('/auth/refresh', { cookie: stolen.refreshToken });
      expect(legit.statusCode).toBe(200);
      const legitToken = refreshCookie(legit);
      const legitAccess = legit.json<{ access_token: string }>().access_token;

      await t.db
        .update(refreshTokens)
        .set({ rotatedAt: new Date(Date.now() - 11_000) })
        .where(eq(refreshTokens.tokenHash, sha256(stolen.refreshToken)));

      // o atacante apresenta o token antigo, fora da janela de graça
      const attackerIp = randomIp();
      const reuse = await t.post('/auth/refresh', { cookie: stolen.refreshToken, ip: attackerIp });
      expect(reuse.statusCode).toBe(401);
      expect(reuse.headers['content-type']).toContain('application/problem+json');

      // o refresh seguinte com o token "legítimo" também falha
      const afterReuse = await t.post('/auth/refresh', { cookie: legitToken });
      expect(afterReuse.statusCode).toBe(401);

      // e o access token da família, ainda dentro dos 15 min, entra na denylist
      const denied = await t.post('/auth/logout-all', { bearer: legitAccess });
      expect(denied.statusCode).toBe(401);
      expect(denied.json()).toMatchObject({ detail: 'Sessão revogada' });
      expect(decodeJwt(legitAccess).exp).toBeGreaterThan(Date.now() / 1000);

      const [family] = await t.db
        .select({ familyId: refreshTokens.familyId })
        .from(refreshTokens)
        .where(eq(refreshTokens.userId, userId));
      const tokens = await familyTokens(family?.familyId ?? '');
      expect(tokens).toHaveLength(2); // nenhum filho novo foi emitido
      for (const token of tokens) {
        expect(token).toMatchObject({
          revokedAt: expect.any(Date) as unknown,
          revokedReason: 'reuse_detected',
        });
      }

      const [entry] = await t.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, 'auth.refresh_reuse_detected'))
        .orderBy(sql`${auditLog.id} DESC`)
        .limit(1);
      expect(entry).toMatchObject({
        userId,
        entity: 'refresh_token_family',
        entityId: family?.familyId,
        metadata: {
          ip: attackerIp,
          user_agent: t.userAgent,
          family_id: family?.familyId,
          token_id: tokens[0]?.id,
        },
      });
    });

    it('dois refresh concorrentes com o mesmo token recebem 200 e a família continua válida', async () => {
      const { refreshToken } = await t.signup();

      const [first, second] = await Promise.all([
        t.post('/auth/refresh', { cookie: refreshToken }),
        t.post('/auth/refresh', { cookie: refreshToken }),
      ]);
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      const [tokenA, tokenB] = [refreshCookie(first), refreshCookie(second)];
      expect(tokenA).not.toBe(tokenB);

      const familyId = decodeJwt(first.json<{ access_token: string }>().access_token)['sid'];
      expect(decodeJwt(second.json<{ access_token: string }>().access_token)['sid']).toBe(familyId);

      const tokens = await familyTokens(familyId as string);
      expect(tokens).toHaveLength(3); // o original + um filho por requisição
      expect(tokens.every((token) => token.revokedAt === null)).toBe(true);

      // as duas abas seguem com sessão válida
      expect((await t.post('/auth/refresh', { cookie: tokenA })).statusCode).toBe(200);
      expect((await t.post('/auth/refresh', { cookie: tokenB })).statusCode).toBe(200);
    });

    it('61º refresh da mesma família em 1 minuto → 429', async () => {
      let { refreshToken } = await t.signup();

      for (let i = 1; i <= 60; i++) {
        const res = await t.post('/auth/refresh', { cookie: refreshToken });
        expect(res.statusCode).toBe(200);
        refreshToken = refreshCookie(res);
      }
      const blocked = await t.post('/auth/refresh', { cookie: refreshToken });
      expect(blocked.statusCode).toBe(429);
      expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(60);
    });
  });

  describe('AuthGuard e logout-all', () => {
    it('rota protegida sem Bearer, ou com Bearer inválido → 401 em Problem Details', async () => {
      const missing = await t.post('/auth/logout-all');
      expect(missing.statusCode).toBe(401);
      expect(missing.headers['www-authenticate']).toBe('Bearer');
      expect(missing.headers['content-type']).toContain('application/problem+json');

      const invalid = await t.post('/auth/logout-all', { bearer: 'não.é.jwt' });
      expect(invalid.statusCode).toBe(401);
    });

    it('logout comum não entra na denylist: o access token vale até expirar', async () => {
      const session = await t.signup();
      expect((await t.post('/auth/logout', { cookie: session.refreshToken })).statusCode).toBe(204);

      const res = await t.post('/auth/logout-all', { bearer: session.accessToken });
      expect(res.statusCode).toBe(204);
    });

    it('logout-all revoga todas as famílias do usuário', async () => {
      const first = await t.signup();
      const login = await t.post('/auth/login', {
        body: { email: first.user.email, password: first.user.password },
      });
      const second = refreshCookie(login);

      const res = await t.post('/auth/logout-all', { bearer: first.accessToken });
      expect(res.statusCode).toBe(204);
      expect(setCookieHeader(res)).toContain('Max-Age=0');

      expect((await t.post('/auth/refresh', { cookie: first.refreshToken })).statusCode).toBe(401);
      expect((await t.post('/auth/refresh', { cookie: second })).statusCode).toBe(401);

      // os access tokens das duas sessões entram na denylist
      const secondAccess = login.json<{ access_token: string }>().access_token;
      for (const bearer of [first.accessToken, secondAccess]) {
        expect((await t.post('/auth/logout-all', { bearer })).statusCode).toBe(401);
      }
      expect(await auditActions(await t.userId(first.user.email))).toEqual([
        'auth.signup',
        'auth.login',
        'auth.logout_all',
      ]);
    });
  });
});
