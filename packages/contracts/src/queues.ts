import { z } from 'zod';

import { defineJobSchema } from './jobs.js';

/** Filas BullMQ (Redis db 0). Os mesmos nomes são usados pelo worker Python. */
export const QUEUES = {
  image: 'image',
  video: 'video',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Nome dos jobs. Sprint 0: só `noop`, que prova a propagação de trace. */
export const JOB_NAMES = {
  noop: 'noop',
} as const;

export const noopJobSchema = defineJobSchema({
  note: z.string().max(200),
});

export type NoopJob = z.infer<typeof noopJobSchema>;
