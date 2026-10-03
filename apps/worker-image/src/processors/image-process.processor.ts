import { context, propagation, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { UnrecoverableError } from 'bullmq';

import { imageProcessJobSchema } from '@casebook/contracts';

import {
  type ImageProcessDeps,
  processImage,
  type ProcessOutcome,
} from '../pipeline/process-image.js';

import type { Job } from 'bullmq';

const tracer = trace.getTracer('casebook-worker-image');

/**
 * `image.process`: reconstrói o contexto OTel do `traceparent` do payload (o
 * span `outbox.relay` do relay) e abre `image.process` como filho; as etapas do
 * pipeline são filhas dele.
 */
export function createImageProcessProcessor(deps: ImageProcessDeps) {
  return async (job: Job<unknown>): Promise<ProcessOutcome> => {
    const parsed = imageProcessJobSchema.safeParse(job.data);
    if (!parsed.success) {
      // Payload fora do contrato não melhora com retry.
      throw new UnrecoverableError(`payload inválido: ${parsed.error.message}`);
    }
    const data = parsed.data;
    const parent = propagation.extract(context.active(), { traceparent: data.traceparent });
    const attempt = job.attemptsMade + 1;

    return tracer.startActiveSpan(
      'image.process',
      {
        kind: SpanKind.CONSUMER,
        attributes: {
          'messaging.system': 'bullmq',
          'messaging.destination.name': job.queueName,
          'messaging.message.id': job.id ?? '',
          'job.name': job.name,
          'job.attempt': attempt,
          'media.id': data.media_id,
        },
      },
      parent,
      async (span) => {
        try {
          const outcome = await processImage(
            data,
            {
              attempt,
              maxAttempts: job.opts.attempts ?? 1,
              // `attemptsStarted` conta também a vez em que o worker caiu no meio.
              resumed: attempt > 1 || job.attemptsStarted > 1,
            },
            deps,
          );
          span.setAttribute('image.outcome', outcome);
          return outcome;
        } catch (err) {
          span.recordException(err as Error);
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw err;
        } finally {
          span.end();
        }
      },
    );
  };
}
