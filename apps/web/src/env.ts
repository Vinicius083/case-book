import 'server-only';

import { z } from 'zod';

import { parseEnv } from '@casebook/contracts';

const webEnvSchema = z.object({
  /** URL da API vista pelo servidor Next (em container: http://api:3001). */
  API_URL: z.url(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url(),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

let cached: WebEnv | undefined;

/**
 * Lido sob demanda, não no import: `next build` avalia módulos sem o env de
 * runtime (ex.: no build da imagem Docker).
 */
export function getEnv(): WebEnv {
  cached ??= parseEnv(webEnvSchema);
  return cached;
}
