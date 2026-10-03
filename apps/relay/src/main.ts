import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import { parseEnv, QUEUES } from '@casebook/contracts';
import { createDb } from '@casebook/db';
import { Storage } from '@casebook/storage';

import { relayEnvSchema } from './env.js';
import { sdk } from './instrumentation.js';
import { startMaintenance } from './maintenance/maintenance.js';
import { OutboxListener } from './outbox/outbox-listener.js';
import { OutboxRelay } from './outbox/outbox-relay.js';

// Processo separado da API: escala por conta própria e roda um por ambiente
// (duas instâncias também funcionam — o SKIP LOCKED divide os lotes).
const env = parseEnv(relayEnvSchema);

const db = createDb(env.DATABASE_URL, { max: 4 });
const storage = new Storage(env);

// Produtor: falha na hora com o Redis fora (sem fila offline), para a transação
// do lote desfazer e o evento continuar pendente no outbox.
const queueConnection = new Redis(env.REDIS_URL, {
  db: 0, // convenção: db 0 = filas
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
});
// Consumidor da fila de manutenção: o BullMQ exige retries ilimitados em workers.
const workerConnection = new Redis(env.REDIS_URL, { db: 0, maxRetriesPerRequest: null });
for (const connection of [queueConnection, workerConnection]) {
  connection.on('error', () => undefined); // reconexão é automática; o relay loga as falhas
}

const imageQueue = new Queue(QUEUES.image, { connection: queueConnection });
const relay = new OutboxRelay(
  db,
  { image: imageQueue },
  { batchSize: env.RELAY_BATCH_SIZE, pollIntervalMs: env.RELAY_POLL_INTERVAL_MS },
);
const listener = new OutboxListener(env.DATABASE_URL, () => {
  relay.kick();
});
const maintenance = startMaintenance({ db, storage, queueConnection, workerConnection });

relay.start();
await listener.start();
console.log(
  `[relay] publicando o outbox (LISTEN + poll a cada ${String(env.RELAY_POLL_INTERVAL_MS)}ms)`,
);

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  console.log(`[relay] ${signal}: terminando o lote em andamento...`);
  await listener.stop();
  await relay.stop();
  await maintenance.close();
  await imageQueue.close();
  await Promise.all([queueConnection.quit(), workerConnection.quit()]);
  await db.$client.end();
  storage.destroy();
  await sdk.shutdown();
  process.exit(0);
}
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
