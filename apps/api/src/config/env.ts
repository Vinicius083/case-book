import { z } from 'zod';

import { envBoolean } from '@casebook/contracts';

export const apiEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive(),
  WEB_URL: z.url(),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  // Lida pelo OTel SDK em instrumentation.ts; validada aqui para a API não subir
  // sem destino de telemetria.
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url(),
  // Segredo HS256 do access token. 32+ caracteres: abaixo disso a chave é mais
  // fraca que o próprio HMAC-SHA256.
  JWT_ACCESS_SECRET: z.string().min(32),
  // `true` só atrás de proxy confiável (Caddy): passa a ler o IP do cliente de
  // `X-Forwarded-For`. Sem proxy, o header é forjável e furaria o rate limit.
  TRUST_PROXY: envBoolean.default(false),
  // Path do cookie de refresh como o browser o vê. Em produção o Caddy publica a
  // API em `/api`; acessando a API direto (dev, curl) use `/auth`.
  AUTH_COOKIE_PATH: z.string().startsWith('/').default('/api/auth'),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

/** Token de injeção do env validado. */
export const ENV = Symbol('ENV');
