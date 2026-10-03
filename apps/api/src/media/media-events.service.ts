import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

import { type MediaEvent, mediaEventSchema, mediaEventsChannel } from '@casebook/contracts/media';

import { REDIS } from '../redis/redis.module.js';

type Listener = (event: string) => void;

/**
 * Eventos de mídia por usuário (RF-UP-5). Uma conexão de subscriber por
 * processo, compartilhada: o canal `media:user:<id>` é assinado quando a
 * primeira conexão SSE do usuário abre e liberado quando a última fecha; cada
 * mensagem é repassada a todas as conexões dele (fan-out em memória).
 */
@Injectable()
export class MediaEventsService implements OnModuleDestroy {
  private readonly logger = new Logger(MediaEventsService.name);
  private readonly listeners = new Map<string, Set<Listener>>();
  private subscriber: Redis | undefined;

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Assina os eventos do usuário. Devolve a função que cancela a assinatura. */
  async subscribe(userId: string, listener: Listener): Promise<() => Promise<void>> {
    const channel = mediaEventsChannel(userId);
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
      await this.connection().subscribe(channel);
    }
    set.add(listener);

    let active = true;
    return async () => {
      if (!active) return;
      active = false;
      const current = this.listeners.get(channel);
      current?.delete(listener);
      if (current?.size === 0) {
        this.listeners.delete(channel);
        await this.subscriber?.unsubscribe(channel).catch(() => undefined);
      }
    };
  }

  /** Publica um evento (a API publica o "na fila"; o worker, o resto). Nunca lança. */
  async publish(userId: string, event: MediaEvent): Promise<void> {
    try {
      await this.redis.publish(mediaEventsChannel(userId), JSON.stringify(event));
    } catch (err) {
      this.logger.warn(`evento de mídia não publicado: ${String(err)}`);
    }
  }

  /** Para os testes de vazamento: canais assinados e conexões ouvindo. */
  stats(): { channels: number; listeners: number } {
    let listeners = 0;
    for (const set of this.listeners.values()) listeners += set.size;
    return { channels: this.listeners.size, listeners };
  }

  async onModuleDestroy(): Promise<void> {
    this.listeners.clear();
    await this.subscriber?.quit().catch(() => undefined);
  }

  private connection(): Redis {
    if (this.subscriber) return this.subscriber;
    // Em modo subscriber a conexão só serve para pub/sub: precisa ser própria.
    const subscriber = this.redis.duplicate();
    subscriber.on('error', (err: Error) => {
      this.logger.warn(`subscriber de eventos de mídia: ${err.message}`);
    });
    subscriber.on('message', (channel: string, message: string) => {
      const set = this.listeners.get(channel);
      if (!set) return;
      // Repassa só o que respeita o contrato; nada de texto arbitrário no stream.
      let parsed;
      try {
        parsed = mediaEventSchema.safeParse(JSON.parse(message) as unknown);
      } catch {
        return;
      }
      if (!parsed.success) return;
      const payload = JSON.stringify(parsed.data);
      for (const listener of set) listener(payload);
    });
    this.subscriber = subscriber;
    return subscriber;
  }
}
