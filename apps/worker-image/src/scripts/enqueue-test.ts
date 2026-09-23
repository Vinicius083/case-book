// Enfileira um job `noop` com o `traceparent` de um span criado aqui. No SigNoz,
// `enqueue.test` deve aparecer como pai do span do worker, no mesmo trace.
//
//   pnpm --filter @casebook/worker-image enqueue:test          # fila image
//   pnpm --filter @casebook/worker-image enqueue:test video    # fila video (worker Python)
import { context, propagation, SpanKind, trace } from '@opentelemetry/api';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import { JOB_NAMES, type NoopJob, QUEUES, type QueueName } from '@casebook/contracts';

import { env } from '../env.js';
import { startTelemetry } from '../telemetry.js';

const queueName = (process.argv[2] ?? QUEUES.image) as QueueName;
if (!Object.values(QUEUES).includes(queueName)) {
  console.error(`Fila desconhecida: ${queueName}. Use: ${Object.values(QUEUES).join(' | ')}`);
  process.exit(1);
}

const sdk = startTelemetry('casebook-enqueue-test');
const connection = new Redis(env.REDIS_URL, { db: 0, maxRetriesPerRequest: null });
const queue = new Queue(queueName, { connection });

const tracer = trace.getTracer('casebook-enqueue-test');
const traceId = await tracer.startActiveSpan(
  `enqueue.test ${queueName}`,
  { kind: SpanKind.PRODUCER, attributes: { 'messaging.destination.name': queueName } },
  async (span) => {
    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);
    const traceparent = carrier['traceparent'];
    if (!traceparent) throw new Error('propagador não gerou traceparent');

    const payload: NoopJob = { traceparent, note: `teste de propagação (${queueName})` };
    const job = await queue.add(JOB_NAMES.noop, payload, {
      removeOnComplete: 100,
      removeOnFail: 100,
    });
    span.setAttribute('messaging.message.id', job.id ?? '');
    span.end();
    return span.spanContext().traceId;
  },
);

await queue.close();
await connection.quit();
await sdk.shutdown(); // flush do span antes de sair

console.log(`job enfileirado em "${queueName}" — trace_id=${traceId}`);
