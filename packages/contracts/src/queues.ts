import { z } from 'zod';

import { defineJobSchema, traceparentSchema } from './jobs.js';
import { mediaKindSchema } from './media.js';

/** Filas BullMQ (Redis db 0). Os mesmos nomes são usados pelo worker Python. */
export const QUEUES = {
  image: 'image',
  video: 'video',
  /** Jobs agendados (limpezas), consumida pelo relay. */
  maintenance: 'maintenance',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const JOB_NAMES = {
  /** Sprint 0: prova a propagação de trace (`enqueue:test`). */
  noop: 'noop',
  imageProcess: 'image.process',
  /** De hora em hora: uploads `pending` há mais de 24h (RF-UP-6). */
  mediaPendingGc: 'media.pending-gc',
  /** Diário: reservas de handle vencidas. */
  handleReservationsGc: 'handles.reservations-gc',
} as const;

export const noopJobSchema = defineJobSchema({
  note: z.string().max(200),
});

export type NoopJob = z.infer<typeof noopJobSchema>;

/**
 * Job `image.process`, publicado pelo relay a partir de `media.uploaded`. O
 * `traceparent` é o do span `outbox.relay`, filho do request que gerou o evento.
 */
export const imageProcessJobSchema = defineJobSchema({
  media_id: z.uuid(),
  outbox_event_id: z.number().int().positive(),
});

export type ImageProcessJob = z.infer<typeof imageProcessJobSchema>;

// ─── outbox (ADR-4) ──────────────────────────────────────────────────────────

/** Canal do `pg_notify` emitido junto com cada evento de outbox. */
export const OUTBOX_CHANNEL = 'outbox';

export const OUTBOX_EVENTS = {
  mediaUploaded: 'media.uploaded',
} as const;

export type OutboxEventType = (typeof OUTBOX_EVENTS)[keyof typeof OUTBOX_EVENTS];

/**
 * Payload de `media.uploaded` (complete e retry). O `traceparent` completo do
 * span ativo na API fica no payload; a coluna `trace_id` serve só a consultas.
 */
export const mediaUploadedEventSchema = z.object({
  traceparent: traceparentSchema,
  media_id: z.uuid(),
  kind: mediaKindSchema,
});

export type MediaUploadedEvent = z.infer<typeof mediaUploadedEventSchema>;
