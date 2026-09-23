import { context, propagation, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';

import { noopJobSchema } from '@casebook/contracts';

import type { Job } from 'bullmq';

const tracer = trace.getTracer('casebook-worker-image');

export interface NoopResult {
  traceId: string;
}

/**
 * Processor de prova da Sprint 0. Reconstrói o contexto OTel a partir do
 * `traceparent` do payload — o BullMQ não propaga contexto sozinho — e abre
 * `image.process` como filho do span de quem enfileirou.
 */
export async function noopProcessor(job: Job<unknown>): Promise<NoopResult> {
  const data = noopJobSchema.parse(job.data);
  const parent = propagation.extract(context.active(), { traceparent: data.traceparent });

  return tracer.startActiveSpan(
    'image.process',
    {
      kind: SpanKind.CONSUMER,
      attributes: {
        'messaging.system': 'bullmq',
        'messaging.destination.name': job.queueName,
        'messaging.message.id': job.id ?? '',
        'job.name': job.name,
        'job.attempt': job.attemptsMade + 1,
      },
    },
    parent,
    async (span) => {
      try {
        console.log(`[image] job ${job.id ?? '?'} (${job.name}): ${data.note}`);
        await Promise.resolve();
        return { traceId: span.spanContext().traceId };
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw err;
      } finally {
        span.end();
      }
    },
  );
}
