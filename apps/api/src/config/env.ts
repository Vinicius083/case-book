import { z } from 'zod';

export const apiEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive(),
  WEB_URL: z.url(),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  // Lida pelo OTel SDK em instrumentation.ts; validada aqui para a API não subir
  // sem destino de telemetria.
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url(),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

/** Token de injeção do env validado. */
export const ENV = Symbol('ENV');
