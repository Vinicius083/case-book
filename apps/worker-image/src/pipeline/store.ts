import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { type MediaExif, type Palette } from '@casebook/contracts/media';
import { type Database, mediaAssets, mediaDerivatives, mediaJobs } from '@casebook/db';

export const JOB_TYPE = 'image.process';

export type AssetRow = typeof mediaAssets.$inferSelect;

/**
 * `uploaded → processing` (requisitos §6), com `UPDATE … WHERE state`. Uma nova
 * tentativa do mesmo job (retry do BullMQ) já encontra `processing` e segue.
 * Devolve `undefined` quando não há o que processar: asset apagado, inexistente
 * ou em outro estado (ex.: job duplicado de um asset já `ready`).
 */
export async function startProcessing(
  db: Database,
  mediaId: string,
  isRetryAttempt: boolean,
): Promise<AssetRow | undefined> {
  const from = isRetryAttempt ? (['uploaded', 'processing'] as const) : (['uploaded'] as const);
  const [row] = await db
    .update(mediaAssets)
    .set({ state: 'processing', updatedAt: sql`now()` })
    .where(
      and(
        eq(mediaAssets.id, mediaId),
        isNull(mediaAssets.deletedAt),
        inArray(mediaAssets.state, [...from]),
      ),
    )
    .returning();
  return row;
}

/** Linha de `media_jobs` do job em andamento: uma por job, `attempts` conta as tentativas. */
export async function recordAttempt(
  db: Database,
  mediaId: string,
  attempt: number,
  traceId: string,
): Promise<string> {
  const [open] = await db
    .select({ id: mediaJobs.id })
    .from(mediaJobs)
    .where(
      and(
        eq(mediaJobs.mediaId, mediaId),
        eq(mediaJobs.jobType, JOB_TYPE),
        inArray(mediaJobs.state, ['queued', 'running']),
      ),
    )
    .orderBy(desc(mediaJobs.queuedAt))
    .limit(1);
  if (open && attempt > 1) {
    await db
      .update(mediaJobs)
      .set({ state: 'running', attempts: attempt, startedAt: sql`now()`, traceId })
      .where(eq(mediaJobs.id, open.id));
    return open.id;
  }
  const [row] = await db
    .insert(mediaJobs)
    .values({
      mediaId,
      jobType: JOB_TYPE,
      state: 'running',
      attempts: attempt,
      traceId,
      startedAt: sql`now()`,
    })
    .returning({ id: mediaJobs.id });
  if (!row) throw new Error('INSERT em media_jobs sem RETURNING');
  return row.id;
}

export interface StoredDerivative {
  format: string;
  width: number;
  height: number;
  bytes: number;
  storageKey: string;
  ssim: number;
  /** `false`: nem a qualidade máxima do formato alcançou o SSIM alvo. */
  ssimTargetMet: boolean;
  quality: number;
}

/**
 * Tudo numa transação (RF-MP-1, §6 "todos os derivativos gravados na mesma
 * transação"): derivativos com upsert no `derivative_unique` (reprocessar não
 * duplica, RNF-7), paleta, EXIF, dimensões, `ready` e o job concluído.
 */
export async function finishProcessing(
  db: Database,
  input: {
    mediaId: string;
    jobId: string;
    width: number;
    height: number;
    palette: Palette;
    exif: MediaExif;
    derivatives: StoredDerivative[];
  },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    for (const d of input.derivatives) {
      // O índice `derivative_unique` é por expressão (COALESCE(width, -1)), que o
      // `onConflictDoUpdate` do Drizzle não aceita como alvo: SQL direto.
      await tx.execute(sql`
        INSERT INTO ${mediaDerivatives}
          (media_id, kind, format, width, height, bytes, storage_key, ssim, ssim_target_met, quality)
        VALUES (${input.mediaId}, 'image', ${d.format}, ${d.width}, ${d.height}, ${d.bytes},
          ${d.storageKey}, ${d.ssim.toFixed(5)}, ${d.ssimTargetMet}, ${d.quality})
        ON CONFLICT (media_id, kind, format, (COALESCE(width, -1))) DO UPDATE SET
          height = EXCLUDED.height,
          bytes = EXCLUDED.bytes,
          storage_key = EXCLUDED.storage_key,
          ssim = EXCLUDED.ssim,
          ssim_target_met = EXCLUDED.ssim_target_met,
          quality = EXCLUDED.quality,
          created_at = now()
      `);
    }
    const [asset] = await tx
      .update(mediaAssets)
      .set({
        state: 'ready',
        width: input.width,
        height: input.height,
        palette: input.palette,
        exif: input.exif,
        errorMessage: null,
        updatedAt: sql`now()`,
      })
      .where(and(eq(mediaAssets.id, input.mediaId), eq(mediaAssets.state, 'processing')))
      .returning({ id: mediaAssets.id });
    await tx
      .update(mediaJobs)
      .set({ state: 'succeeded', finishedAt: sql`now()`, error: null })
      .where(eq(mediaJobs.id, input.jobId));
    return asset !== undefined;
  });
}

/** `processing → failed` com a mensagem para o usuário; o detalhe técnico vai para o job. */
export async function failProcessing(
  db: Database,
  input: { mediaId: string; jobId: string | undefined; userMessage: string; detail: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(mediaAssets)
      .set({ state: 'failed', errorMessage: input.userMessage, updatedAt: sql`now()` })
      .where(and(eq(mediaAssets.id, input.mediaId), eq(mediaAssets.state, 'processing')));
    if (input.jobId) {
      await tx
        .update(mediaJobs)
        .set({ state: 'failed', finishedAt: sql`now()`, error: input.detail.slice(0, 2000) })
        .where(eq(mediaJobs.id, input.jobId));
    }
  });
}

/** Tentativa falhou, mas haverá outra: o job volta a `queued` com o erro anotado. */
export async function recordRetry(db: Database, jobId: string, detail: string): Promise<void> {
  await db
    .update(mediaJobs)
    .set({ state: 'queued', error: detail.slice(0, 2000) })
    .where(eq(mediaJobs.id, jobId));
}
