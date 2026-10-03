import {
  defaultTextMapGetter,
  defaultTextMapSetter,
  ROOT_CONTEXT,
  type Span,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { asc, inArray, isNull, sql } from 'drizzle-orm';

import { type QueueName } from '@casebook/contracts';
import { type Database, outboxEvents } from '@casebook/db';

import { outboxJobId, PROCESS_JOB_OPTIONS, routeOutboxEvent } from './routes.js';

import type { Queue } from 'bullmq';

const tracer = trace.getTracer('casebook-relay');
// Instância própria: o formato do `traceparent` não depende do propagador global.
const w3c = new W3CTraceContextPropagator();

export type RelayQueues = Record<'image', Queue>;

export interface Logger {
  log(message: string): void;
  error(message: string, ...rest: unknown[]): void;
}

export interface OutboxRelayOptions {
  /** Eventos por transação. Padrão: 100. */
  batchSize?: number;
  /** Poll de fallback. Padrão: 5s. */
  pollIntervalMs?: number;
  /** Tempo máximo para o Redis aceitar um lote antes de desistir dele. Padrão: 10s. */
  publishTimeoutMs?: number;
  logger?: Logger;
}

/**
 * Publica no BullMQ os eventos gravados em `outbox_events` (ADR-4, RNF-6).
 *
 * Cada lote é uma transação: `SELECT … FOR UPDATE SKIP LOCKED` pega até
 * `batchSize` eventos ainda não publicados — instâncias em paralelo nunca pegam
 * o mesmo —, publica os jobs, marca `published_at` e faz commit. Se o Redis
 * recusar, a transação desfaz e os eventos continuam pendentes para o próximo
 * ciclo. Se o processo cair entre publicar e o commit, o evento sai de novo no
 * próximo ciclo, e o `jobId = outbox-<id>` faz o BullMQ ignorar a duplicata.
 */
export class OutboxRelay {
  private readonly batchSize: number;
  private readonly pollIntervalMs: number;
  private readonly publishTimeoutMs: number;
  private readonly logger: Logger;
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private rerun = false;
  private stopping = false;
  private lastError: string | undefined;

  constructor(
    private readonly db: Database,
    private readonly queues: RelayQueues,
    options: OutboxRelayOptions = {},
  ) {
    this.batchSize = options.batchSize ?? 100;
    this.pollIntervalMs = options.pollIntervalMs ?? 5_000;
    this.publishTimeoutMs = options.publishTimeoutMs ?? 10_000;
    this.logger = options.logger ?? console;
  }

  /** Liga o poll de fallback e faz uma passada imediata. */
  start(): void {
    this.timer = setInterval(() => {
      this.kick();
    }, this.pollIntervalMs);
    this.kick();
  }

  /**
   * Pede uma passada (NOTIFY ou poll). Chamadas durante uma passada não abrem
   * outra em paralelo: marcam que é preciso repetir quando ela terminar.
   */
  kick(): void {
    if (this.stopping) return;
    if (this.running) {
      this.rerun = true;
      return;
    }
    this.running = this.loop().finally(() => {
      this.running = undefined;
    });
  }

  /** Para o poll e espera a passada em andamento. */
  async stop(): Promise<void> {
    this.stopping = true;
    clearInterval(this.timer);
    await this.running;
  }

  /** Publica lotes até esvaziar o outbox. Devolve os ids publicados por esta instância. */
  async drain(): Promise<number[]> {
    const published: number[] = [];
    for (;;) {
      const ids = await this.publishBatch();
      published.push(...ids);
      if (ids.length < this.batchSize || this.stopping) return published;
    }
  }

  /** Um lote, numa transação. Devolve os ids marcados como publicados. */
  async publishBatch(): Promise<number[]> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(outboxEvents)
        .where(isNull(outboxEvents.publishedAt))
        .orderBy(asc(outboxEvents.id))
        .limit(this.batchSize)
        .for('update', { skipLocked: true });
      if (rows.length === 0) return [];

      const spans: Span[] = [];
      const jobs = new Map<QueueName, Parameters<Queue['addBulk']>[0]>();
      try {
        for (const row of rows) {
          const route = routeOutboxEvent(row);
          if (!route) {
            // Marcado como publicado mesmo assim: um evento sem rota no início da
            // fila travaria todos os seguintes.
            this.logger.error(
              `[relay] evento ${String(row.id)} (${row.eventType}) sem rota; descartado`,
            );
            continue;
          }
          const jobId = outboxJobId(row.id);
          const parent = w3c.extract(
            ROOT_CONTEXT,
            { traceparent: route.parentTraceparent },
            defaultTextMapGetter,
          );
          const span = tracer.startSpan(
            'outbox.relay',
            {
              kind: SpanKind.PRODUCER,
              attributes: {
                'messaging.system': 'bullmq',
                'messaging.operation.type': 'send',
                'messaging.destination.name': route.queue,
                'messaging.message.id': jobId,
                'outbox.event_id': row.id,
                'outbox.event_type': row.eventType,
                'outbox.lag_ms': Date.now() - row.createdAt.getTime(),
              },
            },
            parent,
          );
          spans.push(span);

          // O job carrega o contexto do span do relay, não o da API: o worker
          // aparece como filho de `outbox.relay` no trace.
          const carrier: Record<string, string> = {};
          w3c.inject(trace.setSpan(ROOT_CONTEXT, span), carrier, defaultTextMapSetter);
          const traceparent = carrier['traceparent'] ?? route.parentTraceparent;

          const queueJobs = jobs.get(route.queue) ?? [];
          queueJobs.push({
            name: route.name,
            data: route.data(traceparent),
            opts: { ...PROCESS_JOB_OPTIONS, jobId },
          });
          jobs.set(route.queue, queueJobs);
        }

        for (const [queue, batch] of jobs) {
          await withTimeout(
            this.queues[queue as keyof RelayQueues].addBulk(batch),
            this.publishTimeoutMs,
            `Redis não aceitou o lote em ${String(this.publishTimeoutMs)}ms`,
          );
        }

        const ids = rows.map((row) => row.id);
        await tx
          .update(outboxEvents)
          .set({ publishedAt: sql`now()` })
          .where(inArray(outboxEvents.id, ids));
        return ids;
      } catch (err) {
        for (const span of spans) {
          span.recordException(err as Error);
          span.setStatus({ code: SpanStatusCode.ERROR });
        }
        throw err;
      } finally {
        for (const span of spans) span.end();
      }
    });
  }

  private async loop(): Promise<void> {
    do {
      this.rerun = false;
      try {
        const ids = await this.drain();
        if (this.lastError !== undefined) {
          this.logger.log('[relay] publicação normalizada');
          this.lastError = undefined;
        }
        if (ids.length > 0) this.logger.log(`[relay] ${String(ids.length)} evento(s) publicado(s)`);
      } catch (err) {
        // Redis fora: os eventos ficam pendentes e o próximo poll tenta de novo.
        // Loga só quando o erro muda, para não repetir a cada 5s.
        const message = err instanceof Error ? err.message : String(err);
        if (message !== this.lastError) {
          this.logger.error(`[relay] falha ao publicar; eventos seguem pendentes: ${message}`);
          this.lastError = message;
        }
        return;
      }
      // `kick()` e `stop()` mudam as flags durante o `await` acima.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    } while (this.rerun && !this.stopping);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(message));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}
