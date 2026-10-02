import { authTokenSchema } from '@casebook/contracts/auth';

import { loginUrl } from '../auth/next-path';

import { ApiError } from './errors';
import { clearSession, sessionStore, setAccessToken } from './session';

// Mesma origem: o Next reescreve /api/* para a API (em produção, o Caddy). É o que
// faz o cookie `cb_refresh` (Path=/api/auth) valer igual em dev e em produção.
const BASE = '/api';

export interface ApiRequest {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Serializado como JSON. */
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /**
   * `false` nas chamadas em que 401 é a resposta da própria operação (login,
   * signup) e não um access token vencido. Padrão: `true`.
   */
  refreshOn401?: boolean;
}

export interface ApiResponse<T> {
  data: T;
  status: number;
  headers: Headers;
}

/**
 * `fetch` para a API: JSON, `Authorization` com o token em memória e, em 401, um
 * refresh seguido de uma única repetição da requisição. Toda falha vira `ApiError`.
 */
export async function apiFetch<T = unknown>(
  path: string,
  request: ApiRequest = {},
): Promise<ApiResponse<T>> {
  const tokenUsed = sessionStore.getState().accessToken;
  let response = await send(path, request, tokenUsed);

  if (response.status === 401 && request.refreshOn401 !== false) {
    // Se o token em memória já é outro, alguém renovou enquanto esta requisição
    // estava em voo: basta repetir. Senão, entra no refresh compartilhado.
    const current = sessionStore.getState().accessToken;
    const renewed = current !== null && current !== tokenUsed ? 'ok' : await refreshSession();

    if (renewed === 'ok') {
      response = await send(path, request, sessionStore.getState().accessToken);
    } else if (renewed === 'unauthenticated') {
      sessionExpiredHandler();
    }
  }

  if (!response.ok) throw await ApiError.fromResponse(response);

  const data = response.status === 204 ? undefined : ((await response.json()) as unknown);
  return { data: data as T, status: response.status, headers: response.headers };
}

async function send(path: string, request: ApiRequest, token: string | null): Promise<Response> {
  try {
    return await fetch(`${BASE}${path}`, {
      method: request.method ?? 'GET',
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        ...(request.body !== undefined && { 'content-type': 'application/json' }),
        ...(token && { authorization: `Bearer ${token}` }),
        ...request.headers,
      },
      ...(request.body !== undefined && { body: JSON.stringify(request.body) }),
      ...(request.signal && { signal: request.signal }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw ApiError.network();
  }
}

// ─── refresh ─────────────────────────────────────────────────────────────────

/**
 * - `ok`: há access token novo em memória
 * - `unauthenticated`: a API recusou o cookie (ausente, expirado ou revogado)
 * - `unavailable`: não deu para saber (rede, 5xx, 429) — a sessão pode estar válida
 */
export type RefreshResult = 'ok' | 'unauthenticated' | 'unavailable';

let refreshInFlight: Promise<RefreshResult> | undefined;

/**
 * Renova o access token a partir do cookie. Chamadas concorrentes compartilham a
 * mesma promise: N requisições que tomam 401 juntas disparam um refresh só — e
 * o refresh token é de uso único, então dois em paralelo desperdiçariam a rotação.
 */
export function refreshSession(): Promise<RefreshResult> {
  refreshInFlight ??= requestRefresh().finally(() => {
    refreshInFlight = undefined;
  });
  return refreshInFlight;
}

async function requestRefresh(): Promise<RefreshResult> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'same-origin' });
  } catch {
    return 'unavailable';
  }

  if (response.status === 401) {
    clearSession('anonymous');
    return 'unauthenticated';
  }
  const token = response.ok
    ? authTokenSchema.safeParse(await response.json().catch(() => undefined))
    : undefined;
  if (!token?.success) return 'unavailable';

  setAccessToken(token.data.access_token);
  return 'ok';
}

let bootstrap: Promise<RefreshResult> | undefined;

/**
 * No carregamento do app: troca o cookie por um access token, uma única vez por
 * página (o StrictMode e layouts aninhados podem chamar mais de uma). Sem efeito
 * se já há token em memória, como logo depois do login.
 */
export function bootstrapSession(): Promise<RefreshResult> {
  if (sessionStore.getState().accessToken) return Promise.resolve('ok');
  bootstrap ??= refreshSession().then((result) => {
    if (result === 'unavailable') {
      clearSession('unavailable');
      bootstrap = undefined; // permite tentar de novo
    }
    return result;
  });
  return bootstrap;
}

// ─── sessão expirada ─────────────────────────────────────────────────────────

let sessionExpiredHandler = (): void => {
  const { pathname, search } = window.location;
  window.location.assign(loginUrl(`${pathname}${search}`));
};

/** Troca o que acontece quando o refresh é recusado (padrão: ir para o login). */
export function onSessionExpired(handler: () => void): void {
  sessionExpiredHandler = handler;
}

/** Só para testes: zera o estado de módulo. */
export function resetClientForTests(): void {
  refreshInFlight = undefined;
  bootstrap = undefined;
  clearSession('unknown');
}
