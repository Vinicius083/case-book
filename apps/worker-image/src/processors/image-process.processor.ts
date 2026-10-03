import { context, propagation, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';

import { imageProcessJobSchema } from '@casebook/contracts';

import type { Job } from 'bullmq';

const tracer = trace.getTracer('casebook-worker-image');

/**
 * Esqueleto do `image.process` (Sprint 2, parte 1): valida o payload publicado
 * pelo relay e abre o span filho de `outbox.relay`, fechando o trace do clique à
 * fila. O processamento (derivativos, paleta, estado) entra na parte 2.
 */
export async function imageProcessProcessor(job: Job<unknown>): Promise<{ traceId: string }> {
  const data = imageProcessJobSchema.parse(job.data);
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
        'media.id': data.media_id,
      },
    },
    parent,
    async (span) => {
      try {
        console.log(
          `[image] job ${job.id ?? '?'}: mídia ${data.media_id} (processamento na parte 2)`,
        );
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
