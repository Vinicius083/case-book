import { availableParallelism } from 'node:os';

import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import sharp from 'sharp';

import { QUEUES } from '@casebook/contracts';
import { createDb } from '@casebook/db';
import { Storage } from '@casebook/storage';

import { loadEnv } from './env.js';
import { sdk } from './instrumentation.js';
import { heifDecoderFromEnv } from './pipeline/heic.js';
import { SsimPool } from './pipeline/ssim-pool.js';
import { createImageProcessProcessor } from './processors/image-process.processor.js';
import { createImageQueueProcessor } from './processors/index.js';

const env = loadEnv();

// Os núcleos são divididos entre os jobs: cada um fica com a sua fatia, tanto
// no libvips (resize, encode) quanto nas threads de SSIM. Com a concorrência
// padrão (2), uma imagem sozinha não espera atrás de três, e duas ao mesmo
// tempo não disputam a mesma CPU — no MVP (RNF-12) a latência de uma imagem
// importa mais que a vazão. `availableParallelism` respeita o limite de CPU do
// container (cgroup).
const threads = Math.max(1, Math.floor(availableParallelism() / env.WORKER_CONCURRENCY));
sharp.concurrency(threads);
const ssimPool = new SsimPool(threads * env.WORKER_CONCURRENCY);
// Valida no boot que o binário nativo do sharp/libvips carrega nesta imagem.
console.log(
  `[image] sharp ${sharp.versions.sharp} / libvips ${sharp.versions.vips}, ${String(threads)} thread(s) por job`,
);

const db = createDb(env.DATABASE_URL, { max: env.WORKER_CONCURRENCY + 1 });
const storage = new Storage(env);
const connection = new Redis(env.REDIS_URL, {
  db: 0, // convenção: db 0 = filas
  maxRetriesPerRequest: null, // exigido pelo BullMQ em workers
});
// Eventos de mídia (pub/sub não depende do db). Conexão própria: a do worker
// fica bloqueada esperando jobs.
const publisher = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1 });
publisher.on('error', () => undefined); // reconexão automática; falha de PUBLISH é logada no envio

const processImage = createImageProcessProcessor({
  db,
  storage,
  publisher,
  tmpRoot: env.IMAGE_TMP_DIR,
  heif: heifDecoderFromEnv(env.HEIF_DEC_BIN),
  ssimPool,
  threadsPerJob: threads,
});

const worker = new Worker(QUEUES.image, createImageQueueProcessor(processImage), {
  connection,
  concurrency: env.WORKER_CONCURRENCY,
});

worker.on('ready', () => {
  console.log(
    `[image] ouvindo fila "${QUEUES.image}" (concorrência ${String(env.WORKER_CONCURRENCY)})`,
  );
});
worker.on('failed', (job, err) => {
  console.error(
    `[image] job ${job?.id ?? '?'} falhou (tentativa ${String(job?.attemptsMade ?? '?')}): ${err.message}`,
  );
});

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  console.log(`[image] ${signal}: aguardando jobs em andamento...`);
  // close() sem force espera os jobs ativos terminarem.
  await worker.close();
  await ssimPool.close();
  await Promise.all([connection.quit(), publisher.quit()]);
  await db.$client.end();
  storage.destroy();
  await sdk.shutdown();
  process.exit(0);
}
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
