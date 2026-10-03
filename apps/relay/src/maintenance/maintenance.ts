import { SpanStatusCode, trace } from '@opentelemetry/api';
import { type ConnectionOptions, type Job, Queue, Worker } from 'bullmq';

import { JOB_NAMES, QUEUES } from '@casebook/contracts';
import type { Database } from '@casebook/db';
import type { Storage } from '@casebook/storage';

import { gcHandleReservations } from './handle-reservations-gc.js';
import { gcPendingUploads } from './pending-uploads-gc.js';

import type { Logger } from '../outbox/outbox-relay.js';

const tracer = trace.getTracer('casebook-relay');

const HOUR_MS = 60 * 60 * 1000;
const SCHEDULE_RETRY_MS = 30_000;

/** Jobs agendados (`upsertJobScheduler` é idempotente: várias instâncias, um agendamento). */
export const MAINTENANCE_SCHEDULES = [
  {
    id: 'media-pending-gc',
    name: JOB_NAMES.mediaPendingGc,
    repeat: { every: HOUR_MS },
  },
  {
    id: 'handle-reservations-gc',
    name: JOB_NAMES.handleReservationsGc,
    repeat: { pattern: '0 4 * * *', tz: 'UTC' },
  },
] as const;

export interface MaintenanceDeps {
  db: Database;
  storage: Storage;
  logger?: Logger;
}

/** Executa um job de manutenção pelo nome, num span raiz `maintenance <nome>`. */
export function runMaintenanceJob(name: string, deps: MaintenanceDeps): Promise<unknown> {
  const logger = deps.logger ?? console;
  return tracer.startActiveSpan(`maintenance ${name}`, async (span) => {
    try {
      switch (name) {
        case JOB_NAMES.mediaPendingGc: {
          const result = await gcPendingUploads(deps.db, deps.storage);
          span.setAttribute('maintenance.removed', result.removed.length);
          span.setAttribute('maintenance.failed', result.failed.length);
          if (result.removed.length > 0 || result.failed.length > 0) {
            logger.log(
              `[relay] uploads abandonados: ${String(result.removed.length)} removido(s), ${String(result.failed.length)} com falha`,
            );
          }
          return result;
        }
        case JOB_NAMES.handleReservationsGc: {
          const removed = await gcHandleReservations(deps.db);
          span.setAttribute('maintenance.removed', removed);
          return { removed };
        }
        default:
          throw new Error(`job de manutenção desconhecido: ${name}`);
      }
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Agenda os jobs e consome a fila `maintenance`. O agendamento é tentado de
 * novo em segundo plano se o Redis estiver fora no boot: o relay não pode
 * deixar de publicar o outbox por causa da manutenção.
 */
export function startMaintenance(
  deps: MaintenanceDeps & {
    queueConnection: ConnectionOptions;
    workerConnection: ConnectionOptions;
  },
): { close(): Promise<void> } {
  const logger = deps.logger ?? console;
  const queue = new Queue(QUEUES.maintenance, { connection: deps.queueConnection });
  let retry: NodeJS.Timeout | undefined;
  let closed = false;

  const schedule = async (): Promise<void> => {
    try {
      for (const { id, name, repeat } of MAINTENANCE_SCHEDULES) {
        await queue.upsertJobScheduler(id, repeat, {
          name,
          opts: { removeOnComplete: 50, removeOnFail: 50 },
        });
      }
      logger.log('[relay] jobs de manutenção agendados');
    } catch (err) {
      logger.error(`[relay] agendamento falhou, nova tentativa em 30s: ${(err as Error).message}`);
      if (!closed) {
        retry = setTimeout(() => void schedule(), SCHEDULE_RETRY_MS);
      }
    }
  };
  void schedule();

  const worker = new Worker(QUEUES.maintenance, (job: Job) => runMaintenanceJob(job.name, deps), {
    connection: deps.workerConnection,
    concurrency: 1,
  });
  worker.on('failed', (job, err) => {
    logger.error(`[relay] manutenção ${job?.name ?? '?'} falhou: ${err.message}`);
  });

  return {
    async close() {
      closed = true;
      clearTimeout(retry);
      await worker.close();
      await queue.close();
    },
  };
}
