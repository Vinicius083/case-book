import { JOB_NAMES } from '@casebook/contracts';

import { noopProcessor } from './noop.processor.js';

import type { Job } from 'bullmq';

/** Despacha pelo nome do job: a fila `image` recebe `image.process` e o `noop` de teste. */
export function createImageQueueProcessor(imageProcess: (job: Job<unknown>) => Promise<unknown>) {
  return (job: Job<unknown>): Promise<unknown> => {
    switch (job.name) {
      case JOB_NAMES.imageProcess:
        return imageProcess(job);
      case JOB_NAMES.noop:
        return noopProcessor(job);
      default:
        return Promise.reject(new Error(`job desconhecido na fila image: ${job.name}`));
    }
  };
}
