import { tmpdir } from 'node:os';

import { z } from 'zod';

import { parseEnv } from '@casebook/contracts';
import { storageEnvSchema } from '@casebook/storage';

export const workerEnvSchema = z.object({
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url(),
  /**
   * Jobs em paralelo. 2, e não mais: os núcleos são divididos entre os jobs, e
   * na escala do MVP (RNF-12: 50 usuários) a fila quase nunca tem mais de um ou
   * dois uploads — a latência de uma imagem (RNF-3) pesa mais que a vazão.
   */
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  /** Diretório dos arquivos temporários de cada job (apagados no fim). */
  IMAGE_TMP_DIR: z.string().min(1).default(tmpdir()),
  /** Decodificador HEIC: o `heif-dec` do libheif ≥ 1.18 (o primeiro que gera TIFF). */
  HEIF_DEC_BIN: z.string().min(1).optional(),
  ...storageEnvSchema.shape,
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

/** Só o necessário para enfileirar (script `enqueue:test`). */
export const queueEnvSchema = workerEnvSchema.pick({
  REDIS_URL: true,
  OTEL_EXPORTER_OTLP_ENDPOINT: true,
});

export function loadEnv(): WorkerEnv {
  return parseEnv(workerEnvSchema);
}
