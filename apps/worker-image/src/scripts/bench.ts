// Mede o pipeline `image.process` nas imagens de fixtures/bench (ADR 0002), com
// banco e storage de verdade, na mesma divisão de núcleos do worker (main.ts).
//
// Condição de produção: a imagem Docker do worker, limitada a 4 CPUs, com 2
// jobs simultâneos (WORKER_CONCURRENCY padrão). Da raiz do repo, com a infra no ar:
//
//   pnpm --filter @casebook/worker-image fixtures:fetch
//   docker build -f apps/worker-image/Dockerfile -t casebook-worker-image .
//   docker run --rm --cpus=4 --network host --env-file .env \
//     -v "$PWD/apps/worker-image/fixtures/bench:/fixtures:ro" \
//     casebook-worker-image node --enable-source-maps dist/scripts/bench.js /fixtures
//
// Argumentos: <diretório> [rodadas=1] [jobs simultâneos=WORKER_CONCURRENCY]. A última linha da saída é um JSON com
// todas as medições; os objetos criados ficam no storage (prefixos impressos).
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';

import { trace } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { asc, eq, inArray } from 'drizzle-orm';
import { Redis } from 'ioredis';
import sharp from 'sharp';

import { mediaExifSchema } from '@casebook/contracts/media';
import { createDb, mediaAssets, mediaDerivatives, users } from '@casebook/db';
import { Storage, storageKeys } from '@casebook/storage';

import { loadEnv } from '../env.js';
import { heifDecoderFromEnv } from '../pipeline/heic.js';
import { type ImageProcessDeps, processImage } from '../pipeline/process-image.js';
import { SsimPool } from '../pipeline/ssim-pool.js';

import type { ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace-base';

const IMAGE = /\.(jpe?g|png|tiff?|heic|webp|avif)$/i;
/** Fonte do HEIC do conjunto, não um caso do benchmark. */
const SKIP = new Set(['heic-source.jpg']);

const dir = process.argv[2];
const rounds = Number(process.argv[3] ?? 1);
if (!dir) {
  console.error('uso: bench.js <diretório das imagens> [rodadas] [jobs simultâneos]');
  process.exit(1);
}

// Spans por trace, para tirar o tempo de cada etapa sem instrumentar o pipeline de novo.
const spans = new Map<string, ReadableSpan[]>();
const collector: SpanProcessor = {
  onStart: () => undefined,
  onEnd: (span) => {
    const traceId = span.spanContext().traceId;
    spans.set(traceId, [...(spans.get(traceId) ?? []), span]);
  },
  forceFlush: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
};
const sdk = new NodeSDK({ spanProcessors: [collector], instrumentations: [] });
sdk.start();

const env = loadEnv();
const concurrency = env.WORKER_CONCURRENCY;
// Jobs realmente em paralelo; menor que a concorrência mede a imagem sozinha na fila.
const lanes = Number(process.argv[4] ?? concurrency);
const cpus = availableParallelism();
const threads = Math.max(1, Math.floor(cpus / concurrency));
sharp.concurrency(threads);
const ssimPool = new SsimPool(threads * concurrency);
const db = createDb(env.DATABASE_URL, { max: concurrency + 1 });
const storage = new Storage(env);
const publisher = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1 });
const deps: ImageProcessDeps = {
  db,
  storage,
  publisher,
  tmpRoot: env.IMAGE_TMP_DIR,
  heif: heifDecoderFromEnv(env.HEIF_DEC_BIN),
  ssimPool,
  threadsPerJob: threads,
  logger: { log: () => undefined, error: console.error },
};
console.error(
  `[bench] ${String(cpus)} CPU(s), concorrência ${String(concurrency)}, ${String(lanes)} job(s) simultâneos, ${String(threads)} thread(s) por job, libvips ${sharp.versions.vips}`,
);

const files = (await readdir(dir)).filter((f) => IMAGE.test(f) && !SKIP.has(f)).sort();
const tracer = trace.getTracer('casebook-worker-image-bench');
const ms = (span: ReadableSpan | undefined) =>
  span ? span.duration[0] * 1000 + span.duration[1] / 1e6 : 0;

interface Row {
  round: number;
  file: string;
  megapixels: number;
  /** Área do maior derivativo gerado, em MP: a régua do RNF-3 revisado. */
  largestDerivativeMp: number;
  output: string;
  totalMs: number;
  stages: Record<
    'download' | 'decode' | 'search' | 'widths' | 'palette' | 'upload' | 'persist',
    number
  >;
  /** Somas dos tempos das tarefas dos derivativos (se sobrepõem; passam do relógio). */
  sums: Record<'frame' | 'encode' | 'ssim', number>;
  encodes: number;
  quality: Record<'avif' | 'webp' | 'jpeg', number>;
  ssimMin: number;
  derivatives: number;
  targetMissed: number;
  bytesRatio: number;
}

async function runOne(round: number, userId: string, file: string): Promise<Row> {
  const bytes = await readFile(join(dir ?? '', file));
  const id = randomUUID();
  const key = storageKeys.original(userId, id);
  await storage.putObject({
    bucket: storage.buckets.originals,
    key,
    body: bytes,
    contentType: 'application/octet-stream',
  });
  await db.insert(mediaAssets).values({
    id,
    userId,
    kind: 'image',
    state: 'uploaded',
    originalKey: key,
    originalBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest(),
    mime: 'application/octet-stream',
    filename: file,
  });

  const started = performance.now();
  const traceId = await tracer.startActiveSpan('image.process', async (span) => {
    try {
      const outcome = await processImage(
        { traceparent: '', media_id: id, outbox_event_id: 0 },
        { attempt: 1, maxAttempts: 1 },
        deps,
      );
      if (outcome !== 'ready') throw new Error(`${file}: ${outcome}`);
      return span.spanContext().traceId;
    } finally {
      span.end();
    }
  });
  const totalMs = performance.now() - started;

  const mine = spans.get(traceId) ?? [];
  const named = (name: string) => mine.find((s) => s.name === name);
  const derivativesSpan = named('image.derivatives');
  const attr = (name: string) => Number(derivativesSpan?.attributes[name] ?? 0);
  const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, id));
  const rows = await db
    .select()
    .from(mediaDerivatives)
    .where(eq(mediaDerivatives.mediaId, id))
    .orderBy(asc(mediaDerivatives.width));

  const row: Row = {
    round,
    file,
    megapixels: ((asset?.width ?? 0) * (asset?.height ?? 0)) / 1e6,
    largestDerivativeMp: Math.max(...rows.map((d) => (d.width ?? 0) * (d.height ?? 0))) / 1e6,
    output: mediaExifSchema.parse(asset?.exif).color.output_profile,
    totalMs,
    stages: {
      download: ms(named('image.download')),
      // Formato, HEIC, EXIF e o quadro de referência (decode, rotação, cor, resize) com a sua referência de SSIM.
      decode:
        ms(named('image.sniff')) +
        ms(named('image.heic')) +
        ms(named('image.metadata')) +
        attr('image.reference_frame_ms'),
      search: attr('image.search_ms'),
      // Inclui o decode/normalização de cada uma das outras larguras.
      widths: attr('image.widths_ms'),
      palette: ms(named('image.palette')),
      upload: ms(named('derivative.upload')),
      persist: ms(named('image.persist')) + ms(named('image.publish')),
    },
    sums: {
      frame: attr('image.frame_ms'),
      encode: attr('image.encode_ms'),
      ssim: attr('image.ssim_ms'),
    },
    encodes: attr('image.encodes'),
    quality: {
      avif: attr('image.quality.avif'),
      webp: attr('image.quality.webp'),
      jpeg: attr('image.quality.jpeg'),
    },
    ssimMin: Math.min(...rows.map((d) => Number(d.ssim))),
    derivatives: rows.length,
    targetMissed: rows.filter((d) => d.ssimTargetMet === false).length,
    bytesRatio: rows.reduce((sum, d) => sum + d.bytes, 0) / bytes.length,
  };
  console.error(
    `[bench] ${file}: ${(totalMs / 1000).toFixed(1)}s, ${String(row.encodes)} encodes, SSIM mín. ${row.ssimMin.toFixed(4)}, ${String(row.targetMissed)}/${String(row.derivatives)} abaixo do alvo`,
  );
  return row;
}

const results: Row[] = [];
const userIds: string[] = [];
for (let round = 0; round < rounds; round++) {
  const runId = randomBytes(5).toString('hex');
  const [user] = await db
    .insert(users)
    .values({
      email: `bench-${runId}@bench.test.local`,
      passwordHash: 'x',
      handle: `bench-${runId}`,
    })
    .returning({ id: users.id });
  if (!user) throw new Error('usuário não criado');
  userIds.push(user.id);
  // Rodadas ímpares em ordem inversa: os pares que rodam juntos mudam.
  const queue = round % 2 === 0 ? [...files] : [...files].reverse();
  const lane = async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      results.push(await runOne(round, user.id, file));
    }
  };
  await Promise.all(Array.from({ length: lanes }, lane));
}

const mediaIds = (
  await db
    .select({ id: mediaAssets.id })
    .from(mediaAssets)
    .where(inArray(mediaAssets.userId, userIds))
).map((r) => r.id);
await db.delete(users).where(inArray(users.id, userIds));
await ssimPool.close();
await publisher.quit();
await db.$client.end();
storage.destroy();
await sdk.shutdown();

console.log(
  JSON.stringify({
    cpus,
    concurrency,
    lanes,
    threads,
    maxRssMb: Math.round(process.resourceUsage().maxRSS / 1024),
    results,
    // Para limpar o storage: originais em o/<usuário>/, derivativos em m/<mídia>/.
    cleanup: {
      originals: userIds.map((id) => `o/${id}/`),
      media: mediaIds.map((id) => `m/${id}/`),
    },
  }),
);
