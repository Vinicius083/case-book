import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

import { MEDIA_EVENT_NAME, type MediaEvent, mediaEventSchema } from '@casebook/contracts/media';

import { refreshSession } from '../api/client';
import { sessionStore } from '../api/session';

import { createSseParser } from './sse';

/**
 * - `connecting`: primeira conexão ainda em curso
 * - `connected`: recebendo eventos
 * - `reconnecting`: caiu; tentando de novo
 * - `offline`: várias tentativas falharam — sem conexão com a API
 */
export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';

/** Estado da conexão de eventos, para o indicador do app shell. */
export const connectionStore = createStore<{ status: ConnectionStatus }>(() => ({
  status: 'connecting',
}));

export function useConnectionStatus(): ConnectionStatus {
  return useStore(connectionStore, (state) => state.status);
}

/** Tentativas seguidas sem sucesso até dizer "sem conexão". */
const OFFLINE_AFTER = 3;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 15_000;
const RECONNECT_PAUSE_MS = 500;

export interface MediaEventsHandlers {
  onEvent: (event: MediaEvent) => void;
  /**
   * A conexão voltou depois de cair. Eventos emitidos durante a queda não são
   * reenviados: quem depende deles precisa buscar o estado atual.
   */
  onReconnect: () => void;
}

/**
 * Cliente de `GET /media/events` sobre `fetch` — `EventSource` não manda o
 * header `Authorization`, e o access token nunca vai para a URL. Reconecta
 * sozinho, com backoff; em 401 usa o refresh compartilhado do cliente HTTP.
 * Devolve a função que encerra.
 */
export function startMediaEvents(handlers: MediaEventsHandlers): () => void {
  const abort = new AbortController();
  const { signal } = abort;
  // Função, e não `signal.aborted` direto: o TypeScript estreita a propriedade
  // dentro do laço e trataria as checagens depois de um `await` como código morto.
  const stopped = () => signal.aborted;
  const setStatus = (status: ConnectionStatus) => {
    connectionStore.setState({ status });
  };
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      });
    });

  void (async () => {
    let failures = 0;
    let connectedBefore = false;
    setStatus('connecting');

    while (!stopped()) {
      try {
        const token = sessionStore.getState().accessToken;
        const response = await fetch('/api/media/events', {
          headers: {
            accept: 'text/event-stream',
            ...(token && { authorization: `Bearer ${token}` }),
          },
          cache: 'no-store',
          signal,
        });

        if (response.status === 401) {
          const renewed = await refreshSession();
          // Sem sessão: o cliente HTTP cuida do redirecionamento na próxima chamada.
          if (renewed === 'unauthenticated') return;
          if (renewed === 'ok' && failures === 0) {
            failures = 1; // um 401 logo depois de renovar conta como falha, sem laço apertado
            continue;
          }
          throw new Error('sessão não renovada');
        }
        if (!response.ok || !response.body) throw new Error(`HTTP ${String(response.status)}`);

        setStatus('connected');
        if (connectedBefore) handlers.onReconnect();
        connectedBefore = true;
        failures = 0;

        const parse = createSseParser();
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const message of parse(value)) {
            if (message.event !== MEDIA_EVENT_NAME) continue;
            const event = mediaEventSchema.safeParse(safeJson(message.data));
            if (event.success) handlers.onEvent(event.data);
          }
        }
        // O servidor encerra a conexão quando o access token vence: reconecta logo,
        // com uma pausa curta para um servidor que só fecha não virar laço apertado.
        if (stopped()) return;
        setStatus('reconnecting');
        await sleep(RECONNECT_PAUSE_MS);
        continue;
      } catch {
        if (stopped()) return;
      }

      failures++;
      setStatus(failures >= OFFLINE_AFTER ? 'offline' : 'reconnecting');
      await sleep(Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (failures - 1)));
    }
  })();

  return () => {
    abort.abort();
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
