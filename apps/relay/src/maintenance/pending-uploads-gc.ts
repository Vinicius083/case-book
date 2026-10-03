import { and, asc, eq, lt, sql } from 'drizzle-orm';

import { type Database, mediaAssets } from '@casebook/db';
import type { Storage } from '@casebook/storage';

export const PENDING_UPLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface PendingUploadsGcResult {
  removed: string[];
  failed: string[];
}

/**
 * Uploads abandonados (RF-UP-6): asset em `pending` há mais de 24h perde o
 * multipart no storage e a linha. Cada asset é uma transação: o `DELETE … WHERE
 * state = 'pending'` trava a linha, aborta o multipart e só então faz commit —
 * um `complete` que chegue no meio espera e acha a linha apagada (404); se o
 * abort falhar, a linha volta e a próxima execução tenta de novo.
 */
export async function gcPendingUploads(
  db: Database,
  storage: Storage,
  options: { maxAgeMs?: number; limit?: number } = {},
): Promise<PendingUploadsGcResult> {
  const maxAgeMs = options.maxAgeMs ?? PENDING_UPLOAD_MAX_AGE_MS;
  const stale = await db
    .select({ id: mediaAssets.id })
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.state, 'pending'),
        lt(mediaAssets.createdAt, sql`now() - ${maxAgeMs}::bigint * interval '1 millisecond'`),
      ),
    )
    .orderBy(asc(mediaAssets.createdAt))
    .limit(options.limit ?? 500);

  const result: PendingUploadsGcResult = { removed: [], failed: [] };
  for (const { id } of stale) {
    try {
      const removed = await db.transaction(async (tx) => {
        const [row] = await tx
          .delete(mediaAssets)
          .where(and(eq(mediaAssets.id, id), eq(mediaAssets.state, 'pending')))
          .returning({ key: mediaAssets.originalKey, uploadId: mediaAssets.uploadId });
        if (!row) return false; // completado entre a busca e aqui
        if (row.uploadId) {
          await storage.abortMultipartUpload(storage.buckets.originals, row.key, row.uploadId);
        }
        return true;
      });
      if (removed) result.removed.push(id);
    } catch (err) {
      // Ex.: asset pendente referenciado por um bloco (FK RESTRICT). Segue para o próximo.
      console.error(`[relay] GC do upload ${id} falhou:`, err);
      result.failed.push(id);
    }
  }
  return result;
}
