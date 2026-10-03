import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';

import { Queue } from 'bullmq';
import { eq, inArray, sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { imageProcessJobSchema, JOB_NAMES, OUTBOX_EVENTS } from '@casebook/contracts';
import { outboxEvents } from '@casebook/db';
import { type Logger, OutboxListener, OutboxRelay } from '@casebook/relay';

import { AuthHarness } from './auth.helpers.js';
import { cleanupMedia, fakeFile, startUpload, uploadFile } from './media.helpers.js';
import { TcpProxy } from './tcp-proxy.js';
import { findSpan } from './tracing.js';

// Do `complete` ao job na fila, com o relay real (ADR-4, RNF-6, RNF-11).
//
// Todo teste que roda o relay fica neste arquivo: o relay publica qualquer
// evento pendente do banco, e dois arquivos em paralelo roubariam os eventos um
// do outro. Pelo mesmo motivo, um relay do `pnpm dev` rodando ao mesmo tempo
// quebra estes testes. A fila é própria da execução: nenhum worker a consome.
describe('pipeline: upload → outbox → relay → fila', () => {
  const silent: Logger = { log: () => undefined, error: () => undefined };
  const queueName = `test-image-${randomBytes(4).toString('hex')}`;

  let t: AuthHarness;
  let bearer: string;
  let connection: Redis;
  let queue: Queue;
  let relay: OutboxRelay;

  beforeAll(async () => {
    t = await AuthHarness.create();
    bearer = (await t.signup()).accessToken;
    connection = producerConnection(t.env.REDIS_URL);
    queue = new Queue(queueName, { connection });
    await queue.waitUntilReady();
    relay = new OutboxRelay(t.db, { image: queue }, { logger: silent });
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
    await connection.quit();
    await cleanupMedia(t);
    await t.close();
  });

  const eventFor = async (mediaId: string) => {
    const [event] = await t.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, mediaId));
    if (!event) throw new Error(`sem evento de outbox para ${mediaId}`);
    return event;
  };

  it('complete → outbox.relay → job image.process, num único trace', async () => {
    const asset = await uploadFile(t, bearer);
    const event = await eventFor(asset.id);
    expect(event.publishedAt).toBeNull();

    expect(await relay.drain()).toContain(event.id);
    expect((await eventFor(asset.id)).publishedAt).not.toBeNull();

    const job = await queue.getJob(`outbox-${String(event.id)}`);
    if (!job) throw new Error('job não publicado');
    expect(job.name).toBe(JOB_NAMES.imageProcess);
    const data = imageProcessJobSchema.parse(job.data);
    expect(data).toMatchObject({ media_id: asset.id, outbox_event_id: event.id });
    expect(job.opts).toMatchObject({
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
    });

    // upload.complete (API) → outbox.relay (relay) → job, com o mesmo trace_id.
    const complete = findSpan('upload.complete', (s) => s.attributes['media.id'] === asset.id);
    const relaySpan = findSpan('outbox.relay', (s) => s.attributes['outbox.event_id'] === event.id);
    const { traceId, spanId: completeSpanId } = complete.spanContext();
    expect(relaySpan.spanContext().traceId).toBe(traceId);
    expect(relaySpan.parentSpanContext?.spanId).toBe(completeSpanId);
    expect(data.traceparent).toBe(`00-${traceId}-${relaySpan.spanContext().spanId}-01`);
  });

  it('evento publicado de novo (queda antes do commit) não duplica o job', async () => {
    const asset = await uploadFile(t, bearer);
    const event = await eventFor(asset.id);
    await relay.drain();
    const jobId = `outbox-${String(event.id)}`;
    const first = await queue.getJob(jobId);
    if (!first) throw new Error('job não publicado');

    await t.db.update(outboxEvents).set({ publishedAt: null }).where(eq(outboxEvents.id, event.id));
    expect(await relay.drain()).toContain(event.id);

    // Mesmo jobId → o BullMQ ignora o segundo add: o job é o mesmo, não um novo.
    // (Contar a fila inteira não serve: outros testes publicam nela em paralelo.)
    const again = await queue.getJob(jobId);
    expect(again?.timestamp).toBe(first.timestamp);
    const sameMedia = (await queue.getJobs(['waiting', 'delayed', 'active'])).filter(
      (job) => (job.data as { media_id?: string }).media_id === asset.id,
    );
    expect(sameMedia).toHaveLength(1);
  });

  it('LISTEN: o NOTIFY do complete aciona o relay sem esperar o poll', async () => {
    const listening = new OutboxRelay(
      t.db,
      { image: queue },
      {
        pollIntervalMs: 60_000,
        logger: silent,
      },
    );
    const listener = new OutboxListener(
      t.env.DATABASE_URL,
      () => {
        listening.kick();
      },
      silent,
    );
    await listener.start();
    try {
      const asset = await uploadFile(t, bearer);
      await waitFor(async () => (await eventFor(asset.id)).publishedAt !== null, 3_000);
    } finally {
      await listener.stop();
      await listening.stop();
    }
  });

  it('RNF-6: com o Redis fora, complete funciona e o evento espera; ao voltar, publica', async () => {
    const redis = new URL(t.env.REDIS_URL);
    const proxy = new TcpProxy({ host: redis.hostname, port: Number(redis.port || 6379) });
    await proxy.start();
    const proxiedUrl = `redis://127.0.0.1:${String(proxy.port)}`;

    // API e relay falando com o Redis pelo proxy; o resto dos testes segue no Redis real.
    const originalUrl = process.env['REDIS_URL'];
    process.env['REDIS_URL'] = proxiedUrl;
    const api = await AuthHarness.create().finally(() => {
      process.env['REDIS_URL'] = originalUrl;
    });
    const proxiedConnection = producerConnection(proxiedUrl);
    const proxiedQueue = new Queue(queueName, { connection: proxiedConnection });
    await proxiedQueue.waitUntilReady();
    const proxiedRelay = new OutboxRelay(
      api.db,
      { image: proxiedQueue },
      {
        publishTimeoutMs: 2_000,
        logger: silent,
      },
    );

    try {
      const session = await api.signup();
      const { asset, parts } = await startUpload(api, session.accessToken, fakeFile());

      await proxy.stop(); // Redis "cai"

      const res = await api.post(`/media/${asset.id}/complete`, {
        bearer: session.accessToken,
        body: { parts },
      });
      expect(res.statusCode, res.body).toBe(200);
      const event = await eventFor(asset.id);
      expect(event.publishedAt).toBeNull();

      await expect(proxiedRelay.drain()).rejects.toThrow();
      expect((await eventFor(asset.id)).publishedAt).toBeNull();

      await proxy.start(); // Redis volta
      await waitFor(() => proxiedConnection.status === 'ready', 10_000);

      expect(await proxiedRelay.drain()).toContain(event.id);
      expect((await eventFor(asset.id)).publishedAt).not.toBeNull();
      expect(await queue.getJob(`outbox-${String(event.id)}`)).toBeDefined();
    } finally {
      await proxiedQueue.close();
      await proxiedConnection.quit().catch(() => undefined);
      await cleanupMedia(api);
      await api.close();
      await proxy.stop();
    }
  });

  it('duas instâncias em paralelo não publicam o mesmo evento', async () => {
    // Eventos inseridos direto: o que importa aqui é a disputa pelas linhas.
    const ids = (
      await t.db
        .insert(outboxEvents)
        .values(
          Array.from({ length: 40 }, () => {
            const mediaId = randomUUID();
            return {
              aggregate: 'media_asset',
              aggregateId: mediaId,
              eventType: OUTBOX_EVENTS.mediaUploaded,
              payload: {
                traceparent: `00-${randomBytes(16).toString('hex')}-${randomBytes(8).toString('hex')}-01`,
                media_id: mediaId,
                kind: 'image',
              },
            };
          }),
        )
        .returning({ id: outboxEvents.id })
    ).map((row) => row.id);

    try {
      const a = new OutboxRelay(t.db, { image: queue }, { batchSize: 5, logger: silent });
      const b = new OutboxRelay(t.db, { image: queue }, { batchSize: 5, logger: silent });
      const [fromA, fromB] = await Promise.all([a.drain(), b.drain()]);

      const ours = new Set(ids);
      const mineA = fromA.filter((id) => ours.has(id));
      const mineB = fromB.filter((id) => ours.has(id));
      expect(mineA.filter((id) => mineB.includes(id))).toEqual([]);
      expect([...mineA, ...mineB].sort((x, y) => x - y)).toEqual(ids);
      // As duas trabalharam (lotes de 5 em 40 eventos).
      expect(mineA.length).toBeGreaterThan(0);
      expect(mineB.length).toBeGreaterThan(0);

      const unpublished = await t.db
        .select({ count: sql<number>`count(*)::int` })
        .from(outboxEvents)
        .where(sql`${outboxEvents.id} IN ${ids} AND ${outboxEvents.publishedAt} IS NULL`);
      expect(unpublished[0]?.count).toBe(0);
    } finally {
      await t.db.delete(outboxEvents).where(inArray(outboxEvents.id, ids));
    }
  });
});

/** Produtor como no relay: sem fila offline, falha na hora com o Redis fora. */
function producerConnection(url: string): Redis {
  const connection = new Redis(url, {
    db: 0,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: () => 200,
  });
  connection.on('error', () => undefined);
  return connection;
}

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`condição não atingida em ${String(timeoutMs)}ms`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
