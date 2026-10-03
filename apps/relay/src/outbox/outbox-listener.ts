import pg from 'pg';

import { OUTBOX_CHANNEL } from '@casebook/contracts';

import type { Logger } from './outbox-relay.js';

const MIN_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

/**
 * `LISTEN outbox` numa conexão dedicada (fora do pool: o LISTEN vale só para a
 * conexão que o executou). Cai → reconecta com backoff exponencial e, ao voltar,
 * chama `onNotify` uma vez, porque os NOTIFY emitidos durante a queda se perderam.
 */
export class OutboxListener {
  private client: pg.Client | undefined;
  private retryTimer: NodeJS.Timeout | undefined;
  private retryMs = MIN_RETRY_MS;
  private stopped = false;

  constructor(
    private readonly databaseUrl: string,
    private readonly onNotify: () => void,
    private readonly logger: Logger = console,
  ) {}

  async start(): Promise<void> {
    await this.connect();
  }

  get connected(): boolean {
    return this.client !== undefined;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    const client = this.client;
    this.client = undefined;
    await client?.end().catch(() => undefined);
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const client = new pg.Client({ connectionString: this.databaseUrl });
    client.on('notification', () => {
      this.onNotify();
    });
    client.on('error', (err) => {
      this.logger.error(`[relay] conexão do LISTEN caiu: ${err.message}`);
      this.reconnect(client);
    });
    client.on('end', () => {
      this.reconnect(client);
    });

    try {
      await client.connect();
      await client.query(`LISTEN ${OUTBOX_CHANNEL}`);
    } catch (err) {
      this.logger.error(`[relay] LISTEN indisponível: ${(err as Error).message}`);
      this.reconnect(client);
      return;
    }
    // stop() pode ter sido chamado durante o connect.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (this.stopped) {
      await client.end().catch(() => undefined);
      return;
    }
    if (this.retryMs > MIN_RETRY_MS) this.logger.log('[relay] LISTEN restabelecido');
    this.client = client;
    this.retryMs = MIN_RETRY_MS;
    this.onNotify();
  }

  private reconnect(client: pg.Client): void {
    // Eventos atrasados de um client já descartado não abrem outra reconexão.
    if (this.client !== undefined && this.client !== client) return;
    this.client = undefined;
    client.removeAllListeners();
    client.on('error', () => undefined); // o pg emite 'error' sem listener → crash
    void client.end().catch(() => undefined);
    if (this.stopped || this.retryTimer) return;

    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.connect();
    }, this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
  }
}
