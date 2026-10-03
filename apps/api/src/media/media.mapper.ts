import {
  type MediaAssetDetailResponse,
  mediaAssetDetailResponseSchema,
  type MediaAssetResponse,
  mediaAssetResponseSchema,
} from '@casebook/contracts/media';
import type { mediaDerivatives } from '@casebook/db';
import type { Storage } from '@casebook/storage';

import type { MediaAssetRow } from './media-state.js';

type DerivativeRow = typeof mediaDerivatives.$inferSelect;

// A API responde com `.parse` dos schemas de saída: coluna fora do contrato
// (`original_key`, `upload_id`, `sha256`) não vaza; `exif` só no detalhe, já sem GPS.

/** Derivativo de imagem reduzido ao que o `srcset` precisa. */
export interface SourceRow {
  format: string;
  width: number | null;
  storageKey: string;
}

export function toMediaResponse(
  storage: Storage,
  row: MediaAssetRow,
  sources: SourceRow[] = [],
): MediaAssetResponse {
  return mediaAssetResponseSchema.parse(fields(storage, row, sources));
}

export function toMediaDetailResponse(
  storage: Storage,
  row: MediaAssetRow,
  derivatives: DerivativeRow[],
): MediaAssetDetailResponse {
  return mediaAssetDetailResponseSchema.parse({
    ...fields(
      storage,
      row,
      derivatives.filter((d) => d.kind === 'image'),
    ),
    derivatives: derivatives.map((d) => ({
      kind: d.kind,
      format: d.format,
      width: d.width,
      height: d.height,
      bytes: d.bytes,
      url: storage.publicUrl(d.storageKey),
      ssim: d.ssim === null ? null : Number(d.ssim),
      ssim_target_met: d.ssimTargetMet,
      quality: d.quality,
    })),
    exif: row.exif ?? null,
  });
}

function fields(storage: Storage, row: MediaAssetRow, sourceRows: SourceRow[]) {
  const sources = sourceRows
    .filter((s): s is SourceRow & { width: number } => s.width !== null)
    .map((s) => ({ format: s.format, width: s.width, url: storage.publicUrl(s.storageKey) }))
    .sort((a, b) => a.format.localeCompare(b.format) || a.width - b.width);
  const thumbnail = sources.find((s) => s.format === 'webp');
  return {
    id: row.id,
    kind: row.kind,
    state: row.state,
    filename: row.filename,
    alt_text: row.altText,
    mime: row.mime,
    size_bytes: row.originalBytes,
    width: row.width,
    height: row.height,
    palette: row.palette ?? null,
    thumbnail_url: thumbnail?.url ?? null,
    sources,
    error_message: row.errorMessage,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
