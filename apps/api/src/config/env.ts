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
  // Path do cookie de refresh como o browser o vê: ele sempre chega à API por
  // `/api` (rewrite do Next em dev, Caddy em produção). Só para curl direto na
  // porta da API faz sentido trocar por `/auth` (ver docs/api/sprint-1.http).
  AUTH_COOKIE_PATH: z.string().startsWith('/').default('/api/auth'),
  // `false` só em dev, para browser que recusa cookie `Secure` em http://localhost
  // (Safari). Chrome e Firefox tratam localhost como contexto seguro.
  AUTH_COOKIE_SECURE: envBoolean.default(true),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

/** Token de injeção do env validado. */
export const ENV = Symbol('ENV');
