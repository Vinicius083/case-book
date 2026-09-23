import { z } from 'zod';

import { parseEnv } from '@casebook/contracts';

export const env = parseEnv(
  z.object({
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url(),
    WORKER_CONCURRENCY: z.coerce.number().int().positive().default(4),
  }),
);
