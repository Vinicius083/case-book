import { z } from 'zod';

import { envBoolean } from '@casebook/contracts';

/** Variáveis do storage S3-compatível (MinIO em dev, R2 em produção). */
export const storageEnvSchema = z.object({
  /** Endpoint usado pelo processo (dentro do Docker, `http://minio:9000`). */
  S3_ENDPOINT: z.url(),
  /**
   * Endpoint das URLs presigned, como o browser o alcança. A assinatura cobre o
   * host, então ele precisa ser o mesmo que o browser usa. Padrão: `S3_ENDPOINT`.
   */
  S3_PUBLIC_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().min(1).default('auto'),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET_ORIGINALS: z.string().min(1),
  S3_BUCKET_MEDIA: z.string().min(1),
  /** `true` no MinIO; R2 aceita os dois estilos. */
  S3_FORCE_PATH_STYLE: envBoolean.default(false),
  /** Base pública dos derivativos (CDN em produção). */
  PUBLIC_MEDIA_URL: z.url(),
});

export type StorageEnv = z.infer<typeof storageEnvSchema>;
