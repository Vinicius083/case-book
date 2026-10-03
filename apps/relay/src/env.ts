import { z } from 'zod';

import { storageEnvSchema } from '@casebook/storage';

export const relayEnvSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url(),
  /** Poll de fallback do outbox, para NOTIFY perdido (conexão caída, relay reiniciando). */
  RELAY_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
  RELAY_BATCH_SIZE: z.coerce.number().int().min(1).max(1_000).default(100),
  // Só o storage dos originais é usado (abortar multipart abandonado), mas o
  // schema é o mesmo da API.
  ...storageEnvSchema.shape,
});

export type RelayEnv = z.infer<typeof relayEnvSchema>;
