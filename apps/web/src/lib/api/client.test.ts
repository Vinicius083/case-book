import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  apiFetch,
  bootstrapSession,
  onSessionExpired,
  refreshSession,
  resetClientForTests,
} from './client';
import { ApiError } from './errors';
import { sessionStore, setAccessToken } from './session';

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const problem = (status: number, extra: object = {}, headers: Record<string, string> = {}) =>
  new Response(
    JSON.stringify({ type: 'about:blank', title: 'Erro', status, trace_id: 'abc', ...extra }),
    { status, headers: { 'content-type': 'application/problem+json', ...headers } },
  );

const token = (value: string) =>
  json(200, { access_token: value, token_type: 'Bearer', expires_in: 900 });

const bearer = (init: RequestInit) =>
  (init.headers as Record<string, string> | undefined)?.['authorization'];

/** Instala um `fetch` falso e devolve as chamadas feitas a cada URL. */
function mockFetch(handler: Handler) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      return Promise.resolve(handler(url, init));
    }),
  );
  return { calls, to: (url: string) => calls.filter((call) => call.url === url) };
}

describe('cliente HTTP', () => {
  const sessionExpired = vi.fn();

  beforeEach(() => {
    resetClientForTests();
    sessionExpired.mockReset();
    onSessionExpired(sessionExpired);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('manda JSON com o Bearer em memória para /api', async () => {
    setAccessToken('token-atual');
    const fetched = mockFetch(() => json(200, { ok: true }));

    const res = await apiFetch<{ ok: boolean }>('/me/profile', {
      method: 'PATCH',
      body: { bio: 'x' },
      headers: { 'if-match': '"1"' },
    });

    expect(res.data).toEqual({ ok: true });
    const [call] = fetched.calls;
    expect(call?.url).toBe('/api/me/profile');
    expect(call?.init).toMatchObject({
      method: 'PATCH',
      credentials: 'same-origin',
      body: '{"bio":"x"}',
      headers: {
        authorization: 'Bearer token-atual',
        'content-type': 'application/json',
        'if-match': '"1"',
      },
    });
  });

  it('3 requisições concorrentes que recebem 401 disparam exatamente um refresh', async () => {
    setAccessToken('token-vencido');
    let releaseRefresh: () => void = () => undefined;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });

    const fetched = mockFetch(async (url, init) => {
      if (url === '/api/auth/refresh') {
        // Segura o refresh até as três requisições já terem tomado 401.
        await refreshGate;
        return token('token-novo');
      }
      return bearer(init) === 'Bearer token-novo' ? json(200, { url }) : problem(401);
    });

    const requests = Promise.all([apiFetch('/me'), apiFetch('/projects'), apiFetch('/media')]);
    await vi.waitFor(() => {
      expect(fetched.calls.filter((call) => call.url !== '/api/auth/refresh')).toHaveLength(3);
    });
    releaseRefresh();
    const responses = await requests;

    expect(fetched.to('/api/auth/refresh')).toHaveLength(1);
    expect(responses.map((res) => res.data)).toEqual([
      { url: '/api/me' },
      { url: '/api/projects' },
      { url: '/api/media' },
    ]);
    // cada original foi refeita uma única vez, já com o token novo
    for (const url of ['/api/me', '/api/projects', '/api/media']) {
      expect(fetched.to(url).map((call) => bearer(call.init))).toEqual([
        'Bearer token-vencido',
        'Bearer token-novo',
      ]);
    }
    expect(sessionStore.getState()).toEqual({ status: 'authenticated', accessToken: 'token-novo' });
    expect(sessionExpired).not.toHaveBeenCalled();
  });

  it('401 que chega depois de outro já ter renovado só repete, sem novo refresh', async () => {
    setAccessToken('token-vencido');
    const fetched = mockFetch((url, init) => {
      if (url === '/api/auth/refresh') return token('token-novo');
      if (bearer(init) === 'Bearer token-novo') return json(200, {});
      // Enquanto esta resposta "viaja", outra requisição já renovou o token.
      setAccessToken('token-novo');
      return problem(401);
    });

    await apiFetch('/me');

    expect(fetched.to('/api/auth/refresh')).toHaveLength(0);
    expect(fetched.to('/api/me')).toHaveLength(2);
  });

  it('a requisição original é refeita uma vez só: 401 de novo vira erro', async () => {
    setAccessToken('token-vencido');
    const fetched = mockFetch((url) =>
      url === '/api/auth/refresh'
        ? token('token-novo')
        : problem(401, { detail: 'Sessão revogada' }),
    );

    await expect(apiFetch('/me')).rejects.toMatchObject({
      status: 401,
      message: 'Sessão revogada',
    });

    expect(fetched.to('/api/me')).toHaveLength(2);
    expect(fetched.to('/api/auth/refresh')).toHaveLength(1);
  });

  it('refresh recusado: limpa a sessão e chama o redirecionamento para o login', async () => {
    setAccessToken('token-vencido');
    const fetched = mockFetch(() => problem(401));

    await expect(apiFetch('/me')).rejects.toBeInstanceOf(ApiError);

    expect(fetched.to('/api/me')).toHaveLength(1); // sem repetição
    expect(sessionStore.getState()).toEqual({ status: 'anonymous', accessToken: null });
    expect(sessionExpired).toHaveBeenCalledTimes(1);
  });

  it('refresh indisponível (5xx) não derruba a sessão nem redireciona', async () => {
    setAccessToken('token-vencido');
    mockFetch((url) => (url === '/api/auth/refresh' ? problem(503) : problem(401)));

    await expect(apiFetch('/me')).rejects.toMatchObject({ status: 401 });

    expect(sessionStore.getState().accessToken).toBe('token-vencido');
    expect(sessionExpired).not.toHaveBeenCalled();
  });

  it('com refreshOn401: false, o 401 é só a resposta da operação (login)', async () => {
    const fetched = mockFetch(() => problem(401, { detail: 'Email ou senha inválidos' }));

    await expect(
      apiFetch('/auth/login', { method: 'POST', body: {}, refreshOn401: false }),
    ).rejects.toMatchObject({ status: 401, message: 'Email ou senha inválidos' });

    expect(fetched.to('/api/auth/refresh')).toHaveLength(0);
    expect(sessionExpired).not.toHaveBeenCalled();
  });

  describe('ApiError a partir do Problem Details', () => {
    it('422: erros por campo viram fieldErrors no formato de path de formulário', async () => {
      mockFetch(() =>
        problem(422, {
          type: 'urn:casebook:problem:validation',
          detail: 'Um ou mais campos não passaram na validação.',
          errors: [
            { pointer: '/email', detail: 'Email inválido' },
            { pointer: '/links/0/url', detail: 'Use uma URL https://' },
          ],
        }),
      );

      const error = await apiFetch('/x', { refreshOn401: false }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({
        status: 422,
        type: 'urn:casebook:problem:validation',
        traceId: 'abc',
        fieldErrors: { email: 'Email inválido', 'links.0.url': 'Use uma URL https://' },
      });
    });

    it('429: a mensagem diz quanto esperar, a partir do Retry-After', async () => {
      mockFetch(() => problem(429, {}, { 'retry-after': '840' }));

      await expect(apiFetch('/x')).rejects.toMatchObject({
        status: 429,
        retryAfterSec: 840,
        message: 'Muitas tentativas. Tente de novo em 14 minutos.',
      });
    });

    it('falha de rede vira ApiError com status 0', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

      await expect(apiFetch('/x')).rejects.toMatchObject({ status: 0 });
    });

    it('5xx não repassa o detalhe do servidor', async () => {
      mockFetch(() => problem(500, { detail: 'stack trace interno' }));

      const error = (await apiFetch('/x').catch((e: unknown) => e)) as ApiError;
      expect(error.message).not.toContain('stack trace');
    });
  });

  describe('bootstrapSession', () => {
    it('chamadas repetidas (StrictMode) fazem um refresh só', async () => {
      const fetched = mockFetch(() => token('token-do-cookie'));

      const results = await Promise.all([bootstrapSession(), bootstrapSession()]);
      await bootstrapSession();

      expect(results).toEqual(['ok', 'ok']);
      expect(fetched.to('/api/auth/refresh')).toHaveLength(1);
      expect(fetched.calls[0]?.init).toMatchObject({ method: 'POST', credentials: 'same-origin' });
      expect(sessionStore.getState().status).toBe('authenticated');
    });

    it('sem cookie válido a sessão fica anônima', async () => {
      mockFetch(() => problem(401));

      expect(await bootstrapSession()).toBe('unauthenticated');
      expect(sessionStore.getState()).toEqual({ status: 'anonymous', accessToken: null });
    });

    it('API fora: estado "unavailable", e dá para tentar de novo', async () => {
      const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed'));
      vi.stubGlobal('fetch', fetchMock);

      expect(await bootstrapSession()).toBe('unavailable');
      expect(sessionStore.getState().status).toBe('unavailable');

      fetchMock.mockResolvedValueOnce(token('token-do-cookie'));
      expect(await bootstrapSession()).toBe('ok');
    });

    it('não faz nada se já há token em memória (logo após o login)', async () => {
      setAccessToken('token-do-login');
      const fetched = mockFetch(() => token('outro'));

      expect(await bootstrapSession()).toBe('ok');
      expect(fetched.calls).toHaveLength(0);
    });
  });

  it('refreshSession concorrente compartilha a mesma promise', () => {
    mockFetch(() => token('t'));
    expect(refreshSession()).toBe(refreshSession());
  });
});
