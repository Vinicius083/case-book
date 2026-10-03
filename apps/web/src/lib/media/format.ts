import {
  type MediaAssetResponse,
  type MediaColor,
  type MediaSource,
} from '@casebook/contracts/media';

import type { ServerProgress } from './cache';
import type { UploadItem } from './uploads';

const number = (value: number, digits: number) =>
  value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** "812 KB", "4,2 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${number(Math.max(1, Math.round(bytes / 1024)), 0)} KB`;
  return `${number(bytes / 1024 / 1024, 1)} MB`;
}

/** "4000 × 2667 · 4,2 MB" — a segunda linha do item de mídia no design. */
export function formatFacts(
  asset: Pick<MediaAssetResponse, 'width' | 'height' | 'size_bytes'>,
): string {
  const parts: string[] = [];
  if (asset.width && asset.height) parts.push(`${String(asset.width)} × ${String(asset.height)}`);
  if (asset.size_bytes) parts.push(formatBytes(asset.size_bytes));
  return parts.join(' · ');
}

const percent = (fraction: number) => `${String(Math.round(fraction * 100))}%`;

/** Texto da etapa de um envio em curso nesta aba (design, §9.2). */
export function uploadLabel(item: UploadItem): string {
  switch (item.status) {
    case 'waiting':
      return 'Aguardando a vez';
    case 'hashing':
      return 'Calculando…';
    case 'uploading':
      return `Enviando ${percent(item.progress)}`;
    case 'finishing':
      return 'Finalizando o envio…';
    case 'duplicate':
      return 'Você já tinha enviado esse arquivo';
    case 'failed':
      return 'O envio falhou';
    case 'cancelled':
      return 'Envio cancelado';
  }
}

/** Texto da etapa do processamento no servidor (design, §9.2). */
export function processingLabel(progress: ServerProgress | undefined): string {
  switch (progress?.stage) {
    case 'optimizing':
      return progress.progress === null ? 'Otimizando' : `Otimizando ${String(progress.progress)}%`;
    case 'palette':
      return 'Extraindo paleta';
    case 'queued':
    case undefined:
      return 'Na fila';
  }
}

/** 0 a 1 para a barra do card em processamento; `undefined` quando a etapa não mede. */
export function processingFraction(progress: ServerProgress | undefined): number | undefined {
  if (progress?.stage === 'optimizing' && progress.progress !== null)
    return progress.progress / 100;
  if (progress?.stage === 'palette') return 1;
  return undefined;
}

/** "Display P3 · mantido", "Adobe RGB (1998) · convertido para Display P3", "sRGB · mantido". */
export function colorLabel(color: MediaColor): string {
  const source = color.source_profile;
  if (!source) return `${color.output_profile} · sem perfil embutido na origem`;
  const kept =
    color.output_profile === 'Display P3' ? /\bP3\b/i.test(source) : /sRGB/i.test(source);
  return kept
    ? `${color.output_profile} · mantido`
    : `${source} · convertido para ${color.output_profile}`;
}

const MIME_TYPES = { avif: 'image/avif', webp: 'image/webp', jpeg: 'image/jpeg' } as const;

/** `srcset` de um formato, com as larguras realmente geradas. */
export function srcSet(sources: readonly MediaSource[], format: MediaSource['format']): string {
  return sources
    .filter((source) => source.format === format)
    .map((source) => `${source.url} ${String(source.width)}w`)
    .join(', ');
}

/** As fontes de `<picture>` na ordem AVIF → WebP, e o `<img>` de fallback (JPEG, ou o maior WebP). */
export function pictureSources(sources: readonly MediaSource[]) {
  const formats = (['avif', 'webp'] as const)
    .map((format) => ({ type: MIME_TYPES[format], srcSet: srcSet(sources, format) }))
    .filter((entry) => entry.srcSet !== '');
  const fallback =
    sources.find((source) => source.format === 'jpeg') ??
    sources.filter((source) => source.format === 'webp').at(-1) ??
    sources.at(-1);
  return { formats, fallback };
}
