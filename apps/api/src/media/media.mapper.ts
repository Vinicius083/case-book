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
// (`original_key`, `upload_id`, `sha256`, `exif`) não vaza.

export function toMediaResponse(
  storage: Storage,
  row: MediaAssetRow,
  thumbnailKey: string | null = null,
): MediaAssetResponse {
  return mediaAssetResponseSchema.parse(fields(storage, row, thumbnailKey));
}

export function toMediaDetailResponse(
  storage: Storage,
  row: MediaAssetRow,
  derivatives: DerivativeRow[],
): MediaAssetDetailResponse {
  const thumbnail = derivatives
    .filter((d) => d.kind === 'image' && d.format === 'webp' && d.width !== null)
    .sort((a, b) => (a.width ?? 0) - (b.width ?? 0))[0];
  return mediaAssetDetailResponseSchema.parse({
    ...fields(storage, row, thumbnail?.storageKey ?? null),
    derivatives: derivatives.map((d) => ({
      kind: d.kind,
      format: d.format,
      width: d.width,
      height: d.height,
      bytes: d.bytes,
      url: storage.publicUrl(d.storageKey),
      ssim: d.ssim === null ? null : Number(d.ssim),
      quality: d.quality,
    })),
  });
}

function fields(storage: Storage, row: MediaAssetRow, thumbnailKey: string | null) {
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
    thumbnail_url: thumbnailKey === null ? null : storage.publicUrl(thumbnailKey),
    error_message: row.errorMessage,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
