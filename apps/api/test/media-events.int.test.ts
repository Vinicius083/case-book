import 'reflect-metadata';
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { MediaEvent } from '@casebook/contracts/media';

import { MediaEventsService } from '../src/media/media-events.service.js';

import { AuthHarness } from './auth.helpers.js';
import { cleanupMedia, startUpload, fakeFile } from './media.helpers.js';

// SSE de verdade: servidor HTTP escutando numa porta e `fetch` lendo o stream,
// como o front fará (EventSource não manda o header Authorization).
describe('GET /media/events (SSE)', () => {
  let t: AuthHarness;
  let base: string;
  let events: MediaEventsService;

  beforeAll(async () => {
    t = await AuthHarness.create();
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    base = await t.app.getUrl();
    events = t.app.get(MediaEventsService);
  });

  afterAll(async () => {
    await cleanupMedia(t);
    await t.close();
  });

  const event = (mediaId: string, state: MediaEvent['state'] = 'processing'): MediaEvent => ({
    media_id: mediaId,
    state,
    stage: 'optimizing',
    progress: 42,
    error_message: null,
    at: new Date().toISOString(),
  });

  /** Abre o stream e devolve um leitor que acumula o texto recebido. */
  async function open(bearer: string, signal?: AbortSignal) {
    const res = await fetch(`${base}/media/events`, {
      headers: { authorization: `Bearer ${bearer}`, 'user-agent': t.userAgent },
      signal: signal ?? null,
    });
    const reader = res.body?.getReader() as ReadableStreamDefaultReader<Uint8Array> | undefined;
    if (!reader) throw new Error('resposta sem corpo');
    const decoder = new TextDecoder();
    let text = '';
    const until = async (predicate: (text: string) => boolean, timeoutMs = 3_000) => {
      const deadline = Date.now() + timeoutMs;
      while (!predicate(text)) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return false;
        const chunk = await Promise.race([
          reader.read(),
          new Promise<undefined>((resolve) =>
            setTimeout(() => {
              resolve(undefined);
            }, remaining),
          ),
        ]);
        if (!chunk || chunk.done) return predicate(text);
        text += decoder.decode(chunk.value, { stream: true });
      }
      return true;
    };
    return { res, until, text: () => text, cancel: () => reader.cancel() };
  }

  const waitFor = async (condition: () => boolean, timeoutMs = 3_000) => {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error('condição não atingida');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };

  it('headers de stream e comentário inicial', async () => {
    const { accessToken } = await t.signup();
    const stream = await open(accessToken);
    expect(stream.res.status).toBe(200);
    expect(stream.res.headers.get('content-type')).toContain('text/event-stream');
    expect(stream.res.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(stream.res.headers.get('x-accel-buffering')).toBe('no');
    expect(await stream.until((text) => text.includes(': conectado'))).toBe(true);
    await stream.cancel();
  });

  it('sem token → 401', async () => {
    const res = await fetch(`${base}/media/events`);
    expect(res.status).toBe(401);
  });

  it('recebe o evento do próprio usuário e não o de outro', async () => {
    const alice = await t.signup();
    const bob = await t.signup();
    const aliceId = await t.userId(alice.user.email);
    const bobId = await t.userId(bob.user.email);
    const stream = await open(alice.accessToken);
    await stream.until((text) => text.includes(': conectado'));
    await waitFor(() => events.stats().channels > 0);

    const forBob = randomUUID();
    const forAlice = randomUUID();
    await events.publish(bobId, event(forBob));
    await events.publish(aliceId, event(forAlice));

    expect(await stream.until((text) => text.includes(forAlice))).toBe(true);
    expect(stream.text()).toContain('event: media.updated\ndata: ');
    expect(stream.text()).not.toContain(forBob);
    const data = /data: (.+)\n\n/.exec(stream.text())?.[1] ?? '{}';
    expect(JSON.parse(data)).toMatchObject({
      media_id: forAlice,
      stage: 'optimizing',
      progress: 42,
    });
    await stream.cancel();
  });

  it('complete publica "na fila" para o dono', async () => {
    const owner = await t.signup();
    const stream = await open(owner.accessToken);
    await stream.until((text) => text.includes(': conectado'));
    await waitFor(() => events.stats().channels > 0);

    const { asset, parts } = await startUpload(t, owner.accessToken, fakeFile());
    const res = await t.post(`/media/${asset.id}/complete`, {
      bearer: owner.accessToken,
      body: { parts },
    });
    expect(res.statusCode).toBe(200);
    expect(await stream.until((text) => text.includes(asset.id))).toBe(true);
    expect(stream.text()).toContain('"stage":"queued"');
    await stream.cancel();
  });

  it('50 conexões abertas e fechadas: nenhuma assinatura nem listener sobra', async () => {
    // As conexões dos testes anteriores já foram canceladas; espera o servidor
    // perceber, para a contagem partir de zero.
    await waitFor(() => events.stats().listeners === 0, 10_000);
    expect(events.stats()).toEqual({ channels: 0, listeners: 0 });
    const users = await Promise.all(Array.from({ length: 5 }, () => t.signup()));
    const controllers = Array.from({ length: 50 }, () => new AbortController());
    await Promise.all(
      controllers.map((controller, i) =>
        open(users[i % users.length]?.accessToken ?? '', controller.signal),
      ),
    );
    await waitFor(() => events.stats().listeners === 50, 10_000);
    // Cinco usuários, dez conexões cada: cinco canais assinados, não cinquenta.
    expect(events.stats().channels).toBe(5);

    for (const controller of controllers) controller.abort();
    await waitFor(() => events.stats().listeners === 0 && events.stats().channels === 0, 10_000);
  });
});
