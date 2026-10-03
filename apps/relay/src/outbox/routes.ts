import {
  type ImageProcessJob,
  imageProcessJobSchema,
  JOB_NAMES,
  mediaUploadedEventSchema,
  OUTBOX_EVENTS,
  QUEUES,
} from '@casebook/contracts';
import type { outboxEvents } from '@casebook/db';

import type { JobsOptions } from 'bullmq';

type OutboxRow = typeof outboxEvents.$inferSelect;

/**
 * Jobs de processamento: 3 tentativas com backoff exponencial (RF-MP-8; 5s,
 * 10s). Depois da última, o worker marca o asset como `failed`. Os concluídos
 * saem do Redis; os que falharam ficam mais tempo, para inspeção.
 */
export const PROCESS_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { count: 1_000 },
  removeOnFail: { count: 5_000 },
} as const satisfies JobsOptions;

export interface OutboxRoute {
  queue: typeof QUEUES.image;
  name: string;
  /** `traceparent` gravado pela API: pai do span `outbox.relay`. */
  parentTraceparent: string;
  /** Monta o payload com o `traceparent` do span do relay. */
  data(traceparent: string): ImageProcessJob;
}

/**
 * Fila e job de cada evento. `undefined` para evento sem rota (tipo
 * desconhecido, payload inválido ou vídeo, que só ganha worker na Sprint 6).
 */
export function routeOutboxEvent(row: OutboxRow): OutboxRoute | undefined {
  if (row.eventType !== OUTBOX_EVENTS.mediaUploaded) return undefined;
  const parsed = mediaUploadedEventSchema.safeParse(row.payload);
  if (!parsed.success || parsed.data.kind !== 'image') return undefined;
  const event = parsed.data;
  return {
    queue: QUEUES.image,
    name: JOB_NAMES.imageProcess,
    parentTraceparent: event.traceparent,
    data: (traceparent) =>
      imageProcessJobSchema.parse({
        traceparent,
        media_id: event.media_id,
        outbox_event_id: row.id,
      }),
  };
}

/** `jobId` derivado do evento: publicar duas vezes o mesmo evento não duplica o job. */
export function outboxJobId(eventId: number): string {
  // O BullMQ recusa `:` em id customizado (reserva para jobs repetíveis).
  return `outbox-${String(eventId)}`;
}
