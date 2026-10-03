import { extname } from 'node:path';
import { Worker } from 'node:worker_threads';

import {
  type Measurement,
  measureEncoded,
  type PreparedFrame,
  prepareFrame,
  type RawFrame,
} from './ssim.js';

/** Quem mede o SSIM: o pool de threads em produção, ou a própria thread nos testes. */
export interface SsimRunner {
  /** Calcula uma vez a referência de uma largura (luma, médias e variâncias locais). */
  prepare(frame: RawFrame): Promise<PreparedFrame>;
  /** SSIM de um encode contra a referência; `withAlpha` mede também o canal alfa. */
  measure(reference: PreparedFrame, encoded: Uint8Array, withAlpha: boolean): Promise<Measurement>;
}

export type SsimRequest =
  | { type: 'prepare'; frame: RawFrame }
  | { type: 'measure'; reference: PreparedFrame; encoded: Uint8Array; withAlpha: boolean };

export type SsimReply =
  | { ok: true; type: 'prepare'; value: PreparedFrame }
  | { ok: true; type: 'measure'; value: Measurement }
  | { ok: false; error: string };

interface Task {
  request: SsimRequest;
  resolve: (reply: SsimReply) => void;
  reject: (err: Error) => void;
}

/** Mede na própria thread. Para testes e scripts; bloqueia o event loop. */
export const inlineSsim: SsimRunner = {
  prepare: (frame) => Promise.resolve(prepareFrame(frame)),
  measure: measureEncoded,
};

/**
 * Pool de `worker_threads` para o SSIM. A conta é JavaScript puro: na thread
 * principal, ela pararia o event loop (heartbeat do BullMQ, eventos de
 * progresso) e não se sobreporia aos encodes do libvips.
 *
 * As referências trafegam em `SharedArrayBuffer`: preparadas numa thread e
 * lidas pelas outras sem cópia.
 */
export class SsimPool implements SsimRunner {
  private readonly idle: Worker[] = [];
  private readonly busy = new Map<Worker, Task>();
  private readonly queue: Task[] = [];
  private closed = false;

  constructor(readonly size: number) {
    for (let i = 0; i < size; i++) this.spawn();
  }

  async prepare(frame: RawFrame): Promise<PreparedFrame> {
    // Cópia para memória compartilhada: o quadro original segue na thread
    // principal, alimentando os encodes.
    const shared = new Uint8Array(new SharedArrayBuffer(frame.data.byteLength));
    shared.set(frame.data);
    const reply = await this.submit({ type: 'prepare', frame: { ...frame, data: shared } });
    if (reply.type !== 'prepare') throw new Error('resposta inesperada da thread de SSIM');
    return reply.value;
  }

  async measure(
    reference: PreparedFrame,
    encoded: Uint8Array,
    withAlpha: boolean,
  ): Promise<Measurement> {
    const reply = await this.submit({ type: 'measure', reference, encoded, withAlpha });
    if (reply.type !== 'measure') throw new Error('resposta inesperada da thread de SSIM');
    return reply.value;
  }

  /**
   * A fatia de um job: no máximo `limit` medições dele ao mesmo tempo, para um
   * job não ocupar as threads do outro.
   */
  forJob(limit: number): SsimRunner {
    let active = 0;
    const waiting: (() => void)[] = [];
    const limited = async <T>(fn: () => Promise<T>): Promise<T> => {
      if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
      active++;
      try {
        return await fn();
      } finally {
        active--;
        waiting.shift()?.();
      }
    };
    return {
      prepare: (frame) => limited(() => this.prepare(frame)),
      measure: (reference, encoded, withAlpha) =>
        limited(() => this.measure(reference, encoded, withAlpha)),
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    const closed = new Error('pool de SSIM fechado');
    for (const task of this.queue.splice(0)) task.reject(closed);
    const workers = [...this.idle.splice(0), ...this.busy.keys()];
    await Promise.all(workers.map((worker) => worker.terminate()));
  }

  private async submit(request: SsimRequest): Promise<Extract<SsimReply, { ok: true }>> {
    if (this.closed) throw new Error('pool de SSIM fechado');
    const reply = await new Promise<SsimReply>((resolve, reject) => {
      this.queue.push({ request, resolve, reject });
      this.drain();
    });
    if (!reply.ok) throw new Error(`SSIM: ${reply.error}`);
    return reply;
  }

  private drain(): void {
    while (this.queue.length > 0 && this.idle.length > 0) {
      const worker = this.idle.pop();
      const task = this.queue.shift();
      if (!worker || !task) return;
      this.busy.set(worker, task);
      worker.postMessage(task.request);
    }
  }

  private spawn(): void {
    // Mesma extensão deste arquivo: `.js` no dist, `.ts` nos testes (o Node 22
    // remove os tipos ao carregar).
    const worker = new Worker(new URL(`./ssim.worker${extname(import.meta.url)}`, import.meta.url));
    worker.on('message', (reply: SsimReply) => {
      const task = this.busy.get(worker);
      this.busy.delete(worker);
      this.idle.push(worker);
      task?.resolve(reply);
      this.drain();
    });
    // Thread que morre (erro não tratado, falta de memória): a tarefa dela falha
    // — o job trata como erro transitório — e outra thread entra no lugar.
    const replace = (err: Error) => {
      const task = this.busy.get(worker);
      const known = this.busy.delete(worker) || this.removeIdle(worker);
      task?.reject(err);
      if (known && !this.closed) {
        this.spawn();
        this.drain();
      }
    };
    worker.on('error', replace);
    worker.on('exit', (code) => {
      replace(new Error(`thread de SSIM encerrou (código ${String(code)})`));
    });
    this.idle.push(worker);
  }

  private removeIdle(worker: Worker): boolean {
    const at = this.idle.indexOf(worker);
    if (at === -1) return false;
    this.idle.splice(at, 1);
    return true;
  }
}
