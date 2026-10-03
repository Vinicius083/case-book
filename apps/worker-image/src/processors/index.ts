import { JOB_NAMES } from '@casebook/contracts';

import { imageProcessProcessor } from './image-process.processor.js';
import { noopProcessor } from './noop.processor.js';

import type { Job } from 'bullmq';

/** Despacha pelo nome do job: a fila `image` recebe `image.process` e o `noop` de teste. */
export function imageQueueProcessor(job: Job<unknown>): Promise<unknown> {
  switch (job.name) {
    case JOB_NAMES.imageProcess:
      return imageProcessProcessor(job);
    case JOB_NAMES.noop:
      return noopProcessor(job);
    default:
      return Promise.reject(new Error(`job desconhecido na fila image: ${job.name}`));
  }
}
