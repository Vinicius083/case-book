import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import sharp from 'sharp';

import { QUEUES } from '@casebook/contracts';

import { env } from './env.js';
import { sdk } from './instrumentation.js';
import { noopProcessor } from './processors/noop.processor.js';

// Valida no boot que o binário nativo do sharp/libvips carrega nesta imagem.
console.log('[image] sharp', JSON.stringify(sharp.versions));

const connection = new Redis(env.REDIS_URL, {
  db: 0, // convenção: db 0 = filas
  maxRetriesPerRequest: null, // exigido pelo BullMQ em workers
});

const worker = new Worker(QUEUES.image, noopProcessor, {
  connection,
  concurrency: env.WORKER_CONCURRENCY,
});

worker.on('ready', () => {
  console.log(
    `[image] ouvindo fila "${QUEUES.image}" (concorrência ${String(env.WORKER_CONCURRENCY)})`,
  );
});
worker.on('failed', (job, err) => {
  console.error(`[image] job ${job?.id ?? '?'} falhou:`, err);
});

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  console.log(`[image] ${signal}: aguardando jobs em andamento...`);
  // close() sem force espera os jobs ativos terminarem.
  await worker.close();
  await connection.quit();
  await sdk.shutdown();
  process.exit(0);
}
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
