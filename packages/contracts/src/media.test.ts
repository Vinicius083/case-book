import { describe, expect, it } from 'vitest';

import {
  checkUploadIntent,
  completeUploadRequestSchema,
  createUploadRequestSchema,
  isRawFile,
  MEDIA_MAX_BYTES,
  mediaListQuerySchema,
} from './media.js';

const image = { filename: 'still.jpg', mime: 'image/jpeg', size_bytes: 1024 };

describe('checkUploadIntent', () => {
  it('aceita os formatos de imagem do RF-UP-4', () => {
    for (const mime of [
      'image/jpeg',
      'image/png',
      'image/heic',
      'image/tiff',
      'image/webp',
      'image/avif',
    ]) {
      expect(checkUploadIntent({ ...image, mime }, { videoEnabled: false })).toEqual({
        ok: true,
        kind: 'image',
      });
    }
  });

  it.each([
    ['frame.dng', 'image/x-adobe-dng'],
    ['frame.DNG', 'image/tiff'], // DNG declarado como TIFF: pega pela extensão
    ['frame.CR3', ''],
    ['frame.nef', 'application/octet-stream'],
    ['frame.arw', 'image/x-sony-arw'],
    ['exportado.tif', 'image/x-canon-cr2'], // pega pelo MIME
  ])('recusa RAW: %s (%s)', (filename, mime) => {
    expect(checkUploadIntent({ ...image, filename, mime }, { videoEnabled: true })).toEqual({
      ok: false,
      reason: 'raw',
    });
  });

  it('não confunde TIFF comum com RAW', () => {
    expect(isRawFile('grade.tiff', 'image/tiff')).toBe(false);
  });

  it('vídeo depende da flag', () => {
    const video = { filename: 'corte.mov', mime: 'video/quicktime', size_bytes: 1024 };
    expect(checkUploadIntent(video, { videoEnabled: false })).toEqual({
      ok: false,
      reason: 'video_disabled',
    });
    expect(checkUploadIntent(video, { videoEnabled: true })).toEqual({ ok: true, kind: 'video' });
  });

  it('recusa tipo desconhecido e tamanho acima do limite do tipo', () => {
    expect(
      checkUploadIntent({ ...image, filename: 'a.gif', mime: 'image/gif' }, { videoEnabled: true }),
    ).toEqual({ ok: false, reason: 'unsupported_type' });
    expect(
      checkUploadIntent(
        { ...image, size_bytes: MEDIA_MAX_BYTES.image + 1 },
        { videoEnabled: true },
      ),
    ).toEqual({ ok: false, reason: 'too_large', maxBytes: MEDIA_MAX_BYTES.image });
  });
});

describe('schemas de entrada', () => {
  it('normaliza o sha256 e o MIME', () => {
    const parsed = createUploadRequestSchema.parse({
      filename: ' still.jpg ',
      mime: 'IMAGE/JPEG',
      size_bytes: 10,
      sha256: 'A'.repeat(64),
    });
    expect(parsed).toEqual({
      filename: 'still.jpg',
      mime: 'image/jpeg',
      size_bytes: 10,
      sha256: 'a'.repeat(64),
    });
  });

  it('recusa nome com separador de caminho e parte repetida', () => {
    expect(
      createUploadRequestSchema.safeParse({
        filename: '../x.jpg',
        mime: 'image/jpeg',
        size_bytes: 1,
        sha256: 'a'.repeat(64),
      }).success,
    ).toBe(false);
    expect(
      completeUploadRequestSchema.safeParse({
        parts: [
          { part_number: 1, etag: '"a"' },
          { part_number: 1, etag: '"b"' },
        ],
      }).success,
    ).toBe(false);
  });

  it('lista: limite padrão 50, busca vazia some', () => {
    expect(mediaListQuerySchema.parse({ q: '  ' })).toEqual({ limit: 50 });
    expect(mediaListQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
  });
});
