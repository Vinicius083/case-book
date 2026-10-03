import { type MediaEvent, mediaEventsChannel, type MediaState } from '@casebook/contracts/media';

import type { Redis } from 'ioredis';

type Stage = MediaEvent['stage'];

/** Intervalo mínimo entre eventos de progresso da mesma etapa. */
export const PROGRESS_INTERVAL_MS = 500;

/**
 * Publica `MediaEvent` em `media:user:<userId>` (a API repassa por SSE).
 * Falha de publicação nunca derruba o processamento: o estado já está no banco,
 * e o front reconcilia por `GET /media/:id`.
 */
export class MediaEventPublisher {
  private lastStage: Stage | undefined;
  private lastAt = 0;

  constructor(
    private readonly redis: Redis,
    private readonly userId: string,
    private readonly mediaId: string,
    private readonly onError: (err: unknown) => void = () => undefined,
  ) {}

  /** Mudança de etapa sai na hora; progresso dentro da etapa, no máximo a cada 500ms. */
  progress(stage: NonNullable<Stage>, progress: number | null): void {
    const now = Date.now();
    if (stage === this.lastStage && now - this.lastAt < PROGRESS_INTERVAL_MS) return;
    this.lastStage = stage;
    this.lastAt = now;
    void this.publish('processing', stage, progress, null);
  }

  /** Evento final (ready ou failed), sem limite de frequência. */
  final(
    state: Extract<MediaState, 'ready' | 'failed'>,
    errorMessage: string | null,
  ): Promise<void> {
    return this.publish(state, null, null, errorMessage);
  }

  private async publish(
    state: MediaState,
    stage: Stage,
    progress: number | null,
    errorMessage: string | null,
  ): Promise<void> {
    const event: MediaEvent = {
      media_id: this.mediaId,
      state,
      stage,
      progress: progress === null ? null : Math.max(0, Math.min(100, Math.round(progress))),
      error_message: errorMessage,
      at: new Date().toISOString(),
    };
    try {
      await this.redis.publish(mediaEventsChannel(this.userId), JSON.stringify(event));
    } catch (err) {
      this.onError(err);
    }
  }
}
