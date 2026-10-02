import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RESERVED_HANDLES } from '@casebook/contracts/handle';
import { auditLog, profiles, users } from '@casebook/db';

import { AuthHarness, randomIp, refreshCookie } from './auth.helpers.js';

// Integração: aplicação Nest real contra o Postgres e o Redis do compose.
describe('perfil e handle', () => {
  let t: AuthHarness;

  beforeAll(async () => {
    t = await AuthHarness.create();
  });

  afterAll(async () => {
    await t.close();
  });

  const audit = (userId: string, action: string) =>
    t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.userId, userId), eq(auditLog.action, action)))
      .orderBy(asc(auditLog.id));

  const getMe = async (bearer: string) => {
    const res = await t.get('/me', { bearer });
    expect(res.statusCode).toBe(200);
    return { me: res.json<{ handle: string }>(), etag: String(res.headers.etag) };
  };

  const pointers = (res: { body: string }) =>
    (JSON.parse(res.body) as { errors: { pointer: string }[] }).errors.map((e) => e.pointer);

  describe('handle no signup', () => {
    const signup = (handle: string) =>
      t.post('/auth/signup', { body: { ...t.newUser(), handle, display_name: 'Pessoa' } });

    it.each(RESERVED_HANDLES.filter((handle) => handle.length >= 3))(
      'reservado → 422 em /handle: %s',
      async (handle) => {
        const res = await t.post('/auth/signup', {
          // IP próprio por caso: o limite de signup é 5 por hora por IP.
          ip: randomIp(),
          body: { ...t.newUser(), handle, display_name: 'Pessoa' },
        });
        expect(res.statusCode).toBe(422);
        expect(pointers(res)).toEqual(['/handle']);
      },
    );

    it.each(['ab', '-ana', 'ana_lima', 'a'.repeat(31)])('inválido → 422: %s', async (handle) => {
      const res = await signup(handle);
      expect(res.statusCode).toBe(422);
      expect(pointers(res)).toEqual(['/handle']);
    });

    it('com maiúscula é normalizado e, já em uso, responde 409 em qualquer caixa', async () => {
      const user = t.newUser();
      const mixedCase = user.handle.toUpperCase();

      const created = await t.post('/auth/signup', {
        body: { ...user, handle: ` ${mixedCase} `, display_name: 'Pessoa' },
      });
      expect(created.statusCode).toBe(201);
      const [row] = await t.db.select().from(users).where(eq(users.email, user.email));
      expect(row?.handle).toBe(user.handle);

      const duplicate = await signup(mixedCase);
      expect(duplicate.statusCode).toBe(409);
      expect(pointers(duplicate)).toEqual(['/handle']);
    });
  });

  describe('GET /handles/:handle/availability', () => {
    const availability = async (handle: string, ip?: string) =>
      t.get(`/handles/${encodeURIComponent(handle)}/availability`, { ...(ip && { ip }) });

    it('distingue disponível, em uso, reservado e inválido', async () => {
      const { user } = await t.signup();
      const free = t.newUser().handle;

      expect((await availability(free)).json()).toEqual({ available: true });
      expect((await availability(free.toUpperCase())).json()).toEqual({ available: true });
      expect((await availability(user.handle.toUpperCase())).json()).toEqual({
        available: false,
        reason: 'taken',
      });
      expect((await availability('Admin')).json()).toEqual({
        available: false,
        reason: 'reserved',
      });
      expect((await availability('me')).json()).toEqual({ available: false, reason: 'reserved' });
      expect((await availability('ana_lima')).json()).toEqual({
        available: false,
        reason: 'invalid',
      });
    });

    it('é pública e limitada a 30 por minuto por IP', async () => {
      const ip = randomIp();
      for (let i = 1; i <= 30; i++) {
        expect((await availability('qualquer-um', ip)).statusCode).toBe(200);
      }
      const blocked = await availability('qualquer-um', ip);
      expect(blocked.statusCode).toBe(429);
      expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(60);
    });
  });

  describe('GET /me', () => {
    it('exige autenticação', async () => {
      expect((await t.get('/me')).statusCode).toBe(401);
    });

    it('devolve user + profile, com ETag, sem campos internos', async () => {
      const { user, accessToken } = await t.signup();
      const res = await t.get('/me', { bearer: accessToken });

      expect(res.statusCode).toBe(200);
      expect(res.headers.etag).toMatch(/^"\d+"$/);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.json()).toEqual({
        id: await t.userId(user.email),
        email: user.email,
        email_verified: false,
        handle: user.handle,
        created_at: expect.any(String) as unknown,
        profile: {
          display_name: 'Pessoa de Teste',
          bio: null,
          avatar_media_id: null,
          roles: [],
          links: [],
          theme: {},
          updated_at: expect.any(String) as unknown,
        },
      });
    });
  });

  describe('PATCH /me/profile', () => {
    it('edita parcialmente, renova o ETag e audita só os nomes dos campos', async () => {
      const { user, accessToken } = await t.signup();
      const { etag } = await getMe(accessToken);

      const res = await t.patch('/me/profile', {
        bearer: accessToken,
        headers: { 'if-match': etag },
        body: {
          display_name: '  Ana Lima  ',
          bio: 'Montadora. <b>Sem HTML</b>: isto é texto puro.',
          roles: ['editor', 'colorist'],
          links: [{ label: ' Vimeo ', url: 'https://vimeo.com/analima' }],
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers.etag).not.toBe(etag);
      expect(res.json<{ profile: unknown }>().profile).toMatchObject({
        display_name: 'Ana Lima',
        bio: 'Montadora. <b>Sem HTML</b>: isto é texto puro.',
        roles: ['editor', 'colorist'],
        links: [{ label: 'Vimeo', url: 'https://vimeo.com/analima' }],
      });

      const [entry] = await audit(await t.userId(user.email), 'profile.updated');
      expect(entry?.metadata).toMatchObject({ fields: ['display_name', 'bio', 'roles', 'links'] });
      expect(JSON.stringify(entry?.metadata)).not.toContain('Ana Lima');

      // reenviar os mesmos valores não muda nada: mesmo ETag, sem novo registro
      const same = await t.patch('/me/profile', {
        bearer: accessToken,
        headers: { 'if-match': res.headers.etag },
        body: {
          display_name: 'Ana Lima',
          links: [{ label: 'Vimeo', url: 'https://vimeo.com/analima' }],
        },
      });
      expect(same.statusCode).toBe(200);
      expect(same.headers.etag).toBe(res.headers.etag);
      expect(await audit(await t.userId(user.email), 'profile.updated')).toHaveLength(1);
    });

    it('sem If-Match → 428; com If-Match desatualizado → 409, sem gravar', async () => {
      const { user, accessToken } = await t.signup();
      const { etag: stale } = await getMe(accessToken);

      const missing = await t.patch('/me/profile', { bearer: accessToken, body: { bio: 'x' } });
      expect(missing.statusCode).toBe(428);
      expect(missing.headers['content-type']).toContain('application/problem+json');

      // outra aba salva primeiro
      const first = await t.patch('/me/profile', {
        bearer: accessToken,
        headers: { 'if-match': stale },
        body: { bio: 'primeira edição' },
      });
      expect(first.statusCode).toBe(200);

      const conflict = await t.patch('/me/profile', {
        bearer: accessToken,
        headers: { 'if-match': stale },
        body: { bio: 'edição em cima de dado velho' },
      });
      expect(conflict.statusCode).toBe(409);
      expect(conflict.headers['content-type']).toContain('application/problem+json');
      expect(conflict.json()).toMatchObject({ type: 'urn:casebook:problem:conflict', status: 409 });

      const [profile] = await t.db
        .select()
        .from(profiles)
        .where(eq(profiles.userId, await t.userId(user.email)));
      expect(profile?.bio).toBe('primeira edição');
    });

    it.each(['javascript:alert(1)', 'http://exemplo.com', 'data:text/html,x', 'vimeo.com/ana'])(
      'link que não é https é rejeitado com 422 no campo: %s',
      async (url) => {
        const { accessToken } = await t.signup();
        const { etag } = await getMe(accessToken);

        const res = await t.patch('/me/profile', {
          bearer: accessToken,
          headers: { 'if-match': etag },
          body: { links: [{ label: 'Site', url }] },
        });

        expect(res.statusCode).toBe(422);
        expect(res.headers['content-type']).toContain('application/problem+json');
        expect(pointers(res)).toEqual(['/links/0/url']);
      },
    );

    it('limites: 9 links, rótulo de 41 chars, bio acima do limite e campo desconhecido → 422', async () => {
      const { accessToken } = await t.signup();
      const { etag } = await getMe(accessToken);
      const patch = (body: object) =>
        t.patch('/me/profile', { bearer: accessToken, headers: { 'if-match': etag }, body });
      const link = { label: 'Site', url: 'https://exemplo.com' };

      const tooMany = await patch({ links: Array.from({ length: 9 }, () => link) });
      expect(tooMany.statusCode).toBe(422);
      expect(pointers(tooMany)).toEqual(['/links']);

      const longLabel = await patch({ links: [{ ...link, label: 'x'.repeat(41) }] });
      expect(pointers(longLabel)).toEqual(['/links/0/label']);

      const longBio = await patch({ bio: 'x'.repeat(501) });
      expect(pointers(longBio)).toEqual(['/bio']);

      expect((await patch({ email: 'outro@exemplo.com' })).statusCode).toBe(422);
      expect((await patch({})).statusCode).toBe(422);
    });

    it('avatar só aceita mídia do próprio usuário: id desconhecido → 422 no campo', async () => {
      const { accessToken } = await t.signup();
      const { etag } = await getMe(accessToken);

      const res = await t.patch('/me/profile', {
        bearer: accessToken,
        headers: { 'if-match': etag },
        body: { avatar_media_id: '00000000-0000-4000-8000-000000000000' },
      });

      expect(res.statusCode).toBe(422);
      expect(pointers(res)).toEqual(['/avatar_media_id']);
    });
  });

  describe('PATCH /me/handle', () => {
    const change = (bearer: string, handle: string) =>
      t.patch('/me/handle', { bearer, body: { handle } });

    it('troca o handle, audita antigo e novo, e bloqueia nova troca antes de 30 dias', async () => {
      const { user, accessToken } = await t.signup();
      const userId = await t.userId(user.email);
      const [second, third] = [t.newUser().handle, t.newUser().handle];

      const first = await change(accessToken, second.toUpperCase());
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({ handle: second });

      const [entry] = await audit(userId, 'profile.handle_changed');
      expect(entry?.metadata).toMatchObject({ from: user.handle, to: second });

      // o perfil público acompanha: o handle antigo deixa de resolver
      expect((await t.get(`/public/profiles/${second}`)).statusCode).toBe(200);
      expect((await t.get(`/public/profiles/${user.handle}`)).statusCode).toBe(404);

      const tooSoon = await change(accessToken, third);
      expect(tooSoon.statusCode).toBe(409);
      expect(tooSoon.headers['content-type']).toContain('application/problem+json');
      expect(tooSoon.json()).toMatchObject({
        type: 'urn:casebook:problem:handle-change-too-soon',
        status: 409,
      });
      expect((await getMe(accessToken)).me.handle).toBe(second);

      // reenviar o handle atual não é uma troca
      expect((await change(accessToken, second)).statusCode).toBe(200);

      // passados os 30 dias, a troca volta a ser aceita
      await t.db
        .update(auditLog)
        .set({ createdAt: sql`now() - interval '30 days 1 minute'` })
        .where(and(eq(auditLog.userId, userId), eq(auditLog.action, 'profile.handle_changed')));
      expect((await change(accessToken, third)).statusCode).toBe(200);
    });

    it('handle em uso → 409 em /handle; reservado ou inválido → 422', async () => {
      const other = await t.signup();
      const { accessToken } = await t.signup();

      const taken = await change(accessToken, other.user.handle.toUpperCase());
      expect(taken.statusCode).toBe(409);
      expect(pointers(taken)).toEqual(['/handle']);

      expect((await change(accessToken, 'admin')).statusCode).toBe(422);
      expect((await change(accessToken, 'ana_lima')).statusCode).toBe(422);

      // tentativa recusada não consome a troca dos 30 dias
      expect((await change(accessToken, t.newUser().handle)).statusCode).toBe(200);
    });
  });

  describe('PATCH /me/password', () => {
    it('derruba a sessão de outro dispositivo e mantém a atual', async () => {
      const current = await t.signup();
      const { user } = current;
      const otherLogin = await t.post('/auth/login', {
        body: { email: user.email, password: user.password },
      });
      const other = {
        refreshToken: refreshCookie(otherLogin),
        accessToken: otherLogin.json<{ access_token: string }>().access_token,
      };
      const newPassword = 'nova-senha-de-teste-5678';

      const wrong = await t.patch('/me/password', {
        bearer: current.accessToken,
        body: { current_password: 'não-é-a-senha-atual', new_password: newPassword },
      });
      expect(wrong.statusCode).toBe(422);
      expect(pointers(wrong)).toEqual(['/current_password']);

      const res = await t.patch('/me/password', {
        bearer: current.accessToken,
        body: { current_password: user.password, new_password: newPassword },
      });
      expect(res.statusCode).toBe(204);

      // outro dispositivo: refresh revogado e access token na denylist
      expect((await t.post('/auth/refresh', { cookie: other.refreshToken })).statusCode).toBe(401);
      expect((await t.get('/me', { bearer: other.accessToken })).statusCode).toBe(401);

      // sessão atual: segue valendo
      expect((await t.get('/me', { bearer: current.accessToken })).statusCode).toBe(200);
      expect((await t.post('/auth/refresh', { cookie: current.refreshToken })).statusCode).toBe(
        200,
      );

      // só a senha nova entra
      const login = (password: string) =>
        t.post('/auth/login', { body: { email: user.email, password } });
      expect((await login(user.password)).statusCode).toBe(401);
      expect((await login(newPassword)).statusCode).toBe(200);

      expect(await audit(await t.userId(user.email), 'auth.password_changed')).toHaveLength(1);
    });

    it('nova senha igual à atual ou curta demais → 422', async () => {
      const { user, accessToken } = await t.signup();
      const change = (new_password: string) =>
        t.patch('/me/password', {
          bearer: accessToken,
          body: { current_password: user.password, new_password },
        });

      expect(pointers(await change(user.password))).toEqual(['/new_password']);
      expect(pointers(await change('curta'))).toEqual(['/new_password']);
    });
  });

  describe('GET /public/profiles/:handle', () => {
    it('devolve só campos públicos — sem a chave email — com cache de 60s', async () => {
      const { user } = await t.signup();

      const res = await t.get(`/public/profiles/${user.handle.toUpperCase()}`);

      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('public, max-age=60');
      const body = res.json<{ handle: string }>();
      expect(body).not.toHaveProperty('email');
      expect(Object.keys(body).sort()).toEqual([
        'avatar_media_id',
        'bio',
        'display_name',
        'handle',
        'links',
        'roles',
        'theme',
      ]);
      expect(body.handle).toBe(user.handle);
    });

    it('404 em Problem Details para handle inexistente, inválido ou de conta soft-deleted', async () => {
      const { user } = await t.signup();

      const unknown = await t.get(`/public/profiles/${t.newUser().handle}`);
      expect(unknown.statusCode).toBe(404);
      expect(unknown.headers['content-type']).toContain('application/problem+json');
      expect((await t.get('/public/profiles/ana_lima')).statusCode).toBe(404);

      await t.db.update(users).set({ deletedAt: new Date() }).where(eq(users.email, user.email));
      expect((await t.get(`/public/profiles/${user.handle}`)).statusCode).toBe(404);
    });
  });
});
