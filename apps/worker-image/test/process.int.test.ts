import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { type Job, Queue, Worker } from 'bullmq';
import { asc, eq, like } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { JOB_NAMES } from '@casebook/contracts';
import {
  type MediaEvent,
  mediaEventsChannel,
  mediaExifSchema,
  paletteSchema,
} from '@casebook/contracts/media';
import { createDb, mediaAssets, mediaDerivatives, mediaJobs, users } from '@casebook/db';
import { Storage, storageKeys } from '@casebook/storage';

import { workerEnvSchema } from '../src/env.js';
import { USER_MESSAGES } from '../src/pipeline/errors.js';
import { heifDecoderFromEnv } from '../src/pipeline/heic.js';
import { failAbandoned, type ImageProcessDeps } from '../src/pipeline/process-image.js';
import { SsimPool } from '../src/pipeline/ssim-pool.js';
import { createImageProcessProcessor } from '../src/processors/image-process.processor.js';
import { createImageQueueProcessor } from '../src/processors/index.js';

import { alphaPng, hugeHeaderPng, p3Png, syntheticJpeg } from './images.js';

// Integração: Postgres, Redis e MinIO do compose (pnpm infra:up). Fila própria
// da execução, com um Worker real do BullMQ — retries e backoff de verdade.
describe('image.process', () => {
  const env = workerEnvSchema.parse(process.env);
  const runId = randomBytes(5).toString('hex');
  const db = createDb(env.DATABASE_URL, { max: 4 });
  const storage = new Storage(env);
  const publisher = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1 });
  const subscriber = new Redis(env.REDIS_URL);
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const queueName = `test-image-${runId}`;
  const queue = new Queue(queueName, { connection });
  const heif = heifDecoderFromEnv(env.HEIF_DEC_BIN);
  const ssimPool = new SsimPool(4);
  const events: MediaEvent[] = [];
  let userId: string;

  const deps: ImageProcessDeps = {
    db,
    storage,
    publisher,
    tmpRoot: tmpdir(),
    heif,
    ssimPool,
    threadsPerJob: 2,
    logger: { log: () => undefined, error: () => undefined },
  };
  // O storage dos testes de falha transitória: download sempre quebra.
  const brokenStorage = Object.create(storage) as Storage;
  brokenStorage.downloadToFile = () => Promise.reject(new Error('ECONNRESET simulado'));

  const workers: Worker[] = [];
  const startWorker = (name: string, overrides: Partial<ImageProcessDeps> = {}) => {
    const worker = new Worker(
      name,
      createImageQueueProcessor(createImageProcessProcessor({ ...deps, ...overrides })),
      { connection, concurrency: 2 },
    );
    worker.on('error', () => undefined);
    workers.push(worker);
    return worker;
  };

  beforeAll(async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `w-${runId}@${runId}.test.local`, passwordHash: 'x', handle: `w-${runId}` })
      .returning({ id: users.id });
    if (!user) throw new Error('usuário não criado');
    userId = user.id;
    await subscriber.subscribe(mediaEventsChannel(userId));
    subscriber.on('message', (_channel: string, message: string) => {
      events.push(JSON.parse(message) as MediaEvent);
    });
    startWorker(queueName);
  });

  afterAll(async () => {
    await Promise.all(workers.map((w) => w.close()));
    await ssimPool.close();
    await queue.obliterate({ force: true });
    await queue.close();
    await db.delete(users).where(like(users.email, `%@${runId}.test.local`));
    await db.$client.end();
    await Promise.all([publisher.quit(), subscriber.quit(), connection.quit()]);
    storage.destroy();
  });

  /** Asset em `uploaded` com o original já no bucket privado, como depois do complete. */
  async function uploadedAsset(bytes: Buffer, options: { declaredSha256?: string } = {}) {
    const id = randomUUID();
    const key = storageKeys.original(userId, id);
    await storage.putObject({
      bucket: storage.buckets.originals,
      key,
      body: bytes,
      contentType: 'application/octet-stream',
    });
    const sha = options.declaredSha256 ?? createHash('sha256').update(bytes).digest('hex');
    await db.insert(mediaAssets).values({
      id,
      userId,
      kind: 'image',
      state: 'uploaded',
      originalKey: key,
      originalBytes: bytes.length,
      sha256: Buffer.from(sha, 'hex'),
      mime: 'image/jpeg',
      filename: 'teste.jpg',
    });
    return id;
  }

  async function run(
    mediaId: string,
    options: { queue?: Queue; attempts?: number } = {},
  ): Promise<Job> {
    const target = options.queue ?? queue;
    const job = await target.add(
      JOB_NAMES.imageProcess,
      {
        traceparent: `00-${randomBytes(16).toString('hex')}-${randomBytes(8).toString('hex')}-01`,
        media_id: mediaId,
        outbox_event_id: 1,
      },
      {
        jobId: `test-${randomUUID()}`,
        attempts: options.attempts ?? 3,
        backoff: { type: 'exponential', delay: 50 },
      },
    );
    // Espera o job terminar (concluído ou falha definitiva).
    for (let i = 0; i < 600; i++) {
      const state = await job.getState();
      if (state === 'completed' || state === 'failed') {
        return (await target.getJob(job.id ?? '')) ?? job;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`job ${job.id ?? '?'} não terminou`);
  }

  const assetRow = async (id: string) => {
    const [row] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, id));
    if (!row) throw new Error('asset sumiu');
    return row;
  };
  const derivativesOf = (id: string) =>
    db
      .select()
      .from(mediaDerivatives)
      .where(eq(mediaDerivatives.mediaId, id))
      .orderBy(asc(mediaDerivatives.format), asc(mediaDerivatives.width));
  const jobsOf = (id: string) => db.select().from(mediaJobs).where(eq(mediaJobs.mediaId, id));

  it('do MinIO ao ready: derivativos no bucket e no banco, paleta, EXIF, evento final', async () => {
    const id = await uploadedAsset(await syntheticJpeg(2000, 1333));
    const job = await run(id);
    expect(job.returnvalue).toBe('ready');

    const asset = await assetRow(id);
    expect(asset).toMatchObject({ state: 'ready', width: 2000, height: 1333, errorMessage: null });
    expect(paletteSchema.safeParse(asset.palette).success).toBe(true);
    const exif = mediaExifSchema.parse(asset.exif);
    expect(exif.color).toEqual({
      source_profile: null,
      source_wide_gamut: false,
      output_profile: 'sRGB',
    });

    const derivatives = await derivativesOf(id);
    const widths = (format: string) =>
      derivatives.filter((d) => d.format === format).map((d) => d.width);
    expect(widths('avif')).toEqual([320, 640, 1024, 1600, 2000]);
    expect(widths('webp')).toEqual([320, 640, 1024, 1600, 2000]);
    expect(widths('jpeg')).toEqual([1600]);
    for (const d of derivatives) {
      expect(d.storageKey).toMatch(
        new RegExp(`^m/${id}/${String(d.width)}-[0-9a-f]{8}\\.(avif|webp|jpeg)$`),
      );
      expect(Number(d.ssim)).toBeGreaterThanOrEqual(0.985);
      expect(d.ssimTargetMet).toBe(true);
      expect(d.quality).toBeGreaterThanOrEqual(55);
    }

    // Objeto público, imutável, com o Content-Type do formato.
    const sample = derivatives.find((d) => d.format === 'avif');
    const res = await fetch(storage.publicUrl(sample?.storageKey ?? ''), { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/avif');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    // Público por URL, mas sem listagem: ninguém enumera as chaves do bucket (ADR 0002).
    const listing = await fetch(`${storage.publicUrl('')}?list-type=2`);
    expect(listing.status).toBe(403);

    const [mediaJob] = await jobsOf(id);
    expect(mediaJob).toMatchObject({ state: 'succeeded', attempts: 1, jobType: 'image.process' });

    const mine = events.filter((e) => e.media_id === id);
    expect(mine.some((e) => e.stage === 'optimizing')).toBe(true);
    expect(mine.at(-1)).toMatchObject({ state: 'ready', stage: null, error_message: null });
  });

  it('reprocessar o mesmo asset não duplica derivativos (RNF-7)', async () => {
    const id = await uploadedAsset(await syntheticJpeg(700, 500));
    await run(id);
    const first = await derivativesOf(id);
    await db.update(mediaAssets).set({ state: 'uploaded' }).where(eq(mediaAssets.id, id));
    await run(id);
    const second = await derivativesOf(id);
    expect(second).toHaveLength(first.length);
    expect(second.map((d) => d.id).sort()).toEqual(first.map((d) => d.id).sort());
  });

  it('fonte Display P3: derivativos em P3, perfil de origem e de saída no EXIF', async () => {
    const id = await uploadedAsset(await p3Png(900, 600));
    await run(id);
    const exif = mediaExifSchema.parse((await assetRow(id)).exif);
    expect(exif.color).toMatchObject({ source_wide_gamut: true, output_profile: 'Display P3' });
  });

  it('HEIC: decodificado pelo heif-dec e processado até ready', async () => {
    const heic = await readFile(new URL('../fixtures/test/tiny.heic', import.meta.url));
    const id = await uploadedAsset(heic);
    const job = await run(id);
    expect(job.returnvalue, job.failedReason).toBe('ready');
    expect(await assetRow(id)).toMatchObject({ state: 'ready', width: 480, height: 312 });
  });

  it('HEIC Display P3 (foto de iPhone): o gamut sobrevive à decodificação', async () => {
    const heic = await readFile(new URL('../fixtures/test/tiny-p3.heic', import.meta.url));
    const id = await uploadedAsset(heic);
    const job = await run(id);
    expect(job.returnvalue, job.failedReason).toBe('ready');
    const exif = mediaExifSchema.parse((await assetRow(id)).exif);
    expect(exif.color).toMatchObject({ source_wide_gamut: true, output_profile: 'Display P3' });
  });

  it('PNG com transparência: SSIM e alvo persistidos em todos os derivativos', async () => {
    const id = await uploadedAsset(await alphaPng(500));
    await run(id);
    const derivatives = await derivativesOf(id);
    // 320 e 500px: AVIF e WebP em cada uma, mais o JPEG.
    expect(derivatives.map((d) => d.format).sort()).toEqual([
      'avif',
      'avif',
      'jpeg',
      'webp',
      'webp',
    ]);
    for (const d of derivatives) {
      expect(d.ssimTargetMet).toBe(Number(d.ssim) >= 0.985);
    }
  });

  it.each([
    [
      'sha256 divergente',
      () => syntheticJpeg(300, 200),
      'a'.repeat(64),
      USER_MESSAGES.hashMismatch,
    ],
    [
      'formato inválido',
      () => Promise.resolve(Buffer.from('não é imagem')),
      undefined,
      USER_MESSAGES.unsupportedFormat,
    ],
    [
      'acima de 200 MP',
      () => Promise.resolve(hugeHeaderPng()),
      undefined,
      USER_MESSAGES.tooManyPixels,
    ],
  ] as const)('%s → failed sem retry, com mensagem legível', async (_name, make, sha, message) => {
    const id = await uploadedAsset(await make(), sha ? { declaredSha256: sha } : {});
    const job = await run(id, { attempts: 3 });
    expect(await job.getState()).toBe('failed');
    expect(job.attemptsMade).toBe(1); // UnrecoverableError: sem retry

    expect(await assetRow(id)).toMatchObject({ state: 'failed', errorMessage: message });
    const [mediaJob] = await jobsOf(id);
    expect(mediaJob).toMatchObject({ state: 'failed', attempts: 1 });
    expect(mediaJob?.error).toBeTruthy();
    expect(events.filter((e) => e.media_id === id).at(-1)).toMatchObject({
      state: 'failed',
      error_message: message,
    });
  });

  it('falha transitória: 3 tentativas com backoff, depois failed', async () => {
    const brokenQueueName = `${queueName}-broken`;
    const brokenQueue = new Queue(brokenQueueName, { connection });
    startWorker(brokenQueueName, { storage: brokenStorage });
    try {
      const id = await uploadedAsset(await syntheticJpeg(300, 200));
      const job = await run(id, { queue: brokenQueue, attempts: 3 });
      expect(await job.getState()).toBe('failed');
      expect(job.attemptsMade).toBe(3);
      // Backoff exponencial de 50ms: 50 + 100 entre as três tentativas.
      expect((job.finishedOn ?? 0) - job.timestamp).toBeGreaterThanOrEqual(150);

      expect(await assetRow(id)).toMatchObject({
        state: 'failed',
        errorMessage: USER_MESSAGES.transient,
      });
      const [mediaJob] = await jobsOf(id);
      expect(mediaJob).toMatchObject({ state: 'failed', attempts: 3 });
      expect(mediaJob?.error).toContain('ECONNRESET simulado');
    } finally {
      await brokenQueue.obliterate({ force: true });
      await brokenQueue.close();
    }
  });

  it('worker caiu no meio: o job retomado encontra o asset em processing e termina', async () => {
    const id = await uploadedAsset(await syntheticJpeg(310, 200));
    await db.update(mediaAssets).set({ state: 'processing' }).where(eq(mediaAssets.id, id));
    const data = {
      traceparent: `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`,
      media_id: id,
      outbox_event_id: 1,
    };
    const processor = createImageProcessProcessor(deps);
    const job = (attemptsStarted: number) =>
      ({
        data,
        id: 'retomado',
        name: JOB_NAMES.imageProcess,
        queueName,
        attemptsMade: 0,
        attemptsStarted,
        opts: { attempts: 3 },
      }) as unknown as Job;

    // Job duplicado de um asset que outro worker está processando: ignorado.
    expect(await processor(job(1))).toBe('skipped');
    expect(await assetRow(id)).toMatchObject({ state: 'processing' });
    // O mesmo job devolvido à fila pelo BullMQ depois de o worker cair: segue de `processing`.
    expect(await processor(job(2))).toBe('ready');
    expect(await assetRow(id)).toMatchObject({ state: 'ready' });
  });

  it('worker caiu vezes demais: o asset sai de processing como falho, com evento', async () => {
    const id = await uploadedAsset(await syntheticJpeg(312, 200));
    await db.update(mediaAssets).set({ state: 'processing' }).where(eq(mediaAssets.id, id));
    await failAbandoned(
      {
        traceparent: `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`,
        media_id: id,
        outbox_event_id: 1,
      },
      'job stalled more than allowable limit',
      deps,
    );
    expect(await assetRow(id)).toMatchObject({
      state: 'failed',
      errorMessage: USER_MESSAGES.transient,
    });
    await expect.poll(() => events.filter((e) => e.media_id === id).at(-1)?.state).toBe('failed');
  });

  it('asset apagado ou já pronto: job ignorado', async () => {
    const id = await uploadedAsset(await syntheticJpeg(304, 200));
    await db.update(mediaAssets).set({ deletedAt: new Date() }).where(eq(mediaAssets.id, id));
    const job = await run(id);
    expect(job.returnvalue).toBe('skipped');
    expect(await derivativesOf(id)).toHaveLength(0);
  });
});
