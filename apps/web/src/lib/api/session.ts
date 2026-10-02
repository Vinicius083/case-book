import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/**
 * - `unknown`: ainda não se sabe (antes do bootstrap)
 * - `authenticated`: há access token em memória
 * - `anonymous`: sem sessão
 * - `unavailable`: não deu para perguntar à API (rede, 5xx, 429)
 */
export type SessionStatus = 'unknown' | 'authenticated' | 'anonymous' | 'unavailable';

interface SessionState {
  status: SessionStatus;
  /** Só em memória: nunca vai para localStorage, sessionStorage nem cookie legível. */
  accessToken: string | null;
}

/** Store fora do React: o cliente HTTP lê e troca o token sem depender de componente. */
export const sessionStore = createStore<SessionState>(() => ({
  status: 'unknown',
  accessToken: null,
}));

export function setAccessToken(accessToken: string): void {
  sessionStore.setState({ status: 'authenticated', accessToken });
}

export function clearSession(status: 'anonymous' | 'unavailable' | 'unknown' = 'anonymous'): void {
  sessionStore.setState({ status, accessToken: null });
}

export function useSession<T>(selector: (state: SessionState) => T): T {
  return useStore(sessionStore, selector);
}
