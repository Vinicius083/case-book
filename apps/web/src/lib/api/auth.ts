import type { AuthToken, LoginInput, SignupInput } from '@casebook/contracts/auth';

import { apiFetch } from './client';
import { clearSession, setAccessToken } from './session';

// Em login e signup, 401/409 são a resposta da operação — não há sessão a renovar.

export async function login(input: LoginInput): Promise<void> {
  const { data } = await apiFetch<AuthToken>('/auth/login', {
    method: 'POST',
    body: input,
    refreshOn401: false,
  });
  setAccessToken(data.access_token);
}

export async function signup(input: SignupInput): Promise<void> {
  const { data } = await apiFetch<AuthToken>('/auth/signup', {
    method: 'POST',
    body: input,
    refreshOn401: false,
  });
  setAccessToken(data.access_token);
}

/** Encerra a sessão deste dispositivo. O token em memória some mesmo se a chamada falhar. */
export async function logout(): Promise<void> {
  try {
    await apiFetch('/auth/logout', { method: 'POST', refreshOn401: false });
  } finally {
    clearSession('anonymous');
  }
}

/** Encerra todas as sessões do usuário, em todos os dispositivos. */
export async function logoutAll(): Promise<void> {
  await apiFetch('/auth/logout-all', { method: 'POST' });
  clearSession('anonymous');
}
