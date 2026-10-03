import { createHash, randomBytes } from 'node:crypto';

import { inArray, like } from 'drizzle-orm';
import { expect } from 'vitest';

import type {
  CompleteUploadRequest,
  CreateUploadResponse,
  MediaAssetResponse,
} from '@casebook/contracts/media';
import { mediaAssets, outboxEvents, projects, users } from '@casebook/db';

import type { AuthHarness } from './auth.helpers.js';

/**
 * Bytes aleatórios fazem as vezes da imagem: nesta parte nada lê o conteúdo, e
 * o aleatório garante sha256 único por teste (sem dedupe acidental).
 */
export function fakeFile(bytes = 2048): Buffer {
  return randomBytes(bytes);
}

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function intentBody(bytes: Buffer, overrides: Record<string, unknown> = {}) {
  return {
    filename: 'still.jpg',
    mime: 'image/jpeg',
    size_bytes: bytes.length,
    sha256: sha256Hex(bytes),
    ...overrides,
  };
}

/** PUT de cada parte direto no MinIO, pelas URLs presigned, como o browser faz. */
export async function putParts(
  upload: NonNullable<CreateUploadResponse['upload']>,
  bytes: Buffer,
): Promise<CompleteUploadRequest['parts']> {
  const parts: CompleteUploadRequest['parts'] = [];
  for (const { part_number, url } of upload.parts) {
    const start = (part_number - 1) * upload.part_size;
    const res = await fetch(url, {
      method: 'PUT',
      body: bytes.subarray(start, start + upload.part_size),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    parts.push({ part_number, etag: res.headers.get('etag') ?? '' });
  }
  return parts;
}

/** Intenção + upload das partes, sem o `complete`. */
export async function startUpload(t: AuthHarness, bearer: string, bytes: Buffer) {
  const res = await t.post('/media/uploads', { bearer, body: intentBody(bytes) });
  expect(res.statusCode, res.body).toBe(201);
  const body = res.json<CreateUploadResponse>();
  if (!body.upload) throw new Error('intenção sem URLs de upload');
  return { asset: body.asset, parts: await putParts(body.upload, bytes) };
}

/** Intenção → partes → `complete`: asset em `uploaded`. */
export async function uploadFile(
  t: AuthHarness,
  bearer: string,
  bytes = fakeFile(),
): Promise<MediaAssetResponse> {
  const { asset, parts } = await startUpload(t, bearer, bytes);
  const res = await t.post(`/media/${asset.id}/complete`, { bearer, body: { parts } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<MediaAssetResponse>();
}

/**
 * Apaga o que a execução criou fora do cascade de `users`: eventos de outbox
 * (sem FK) e projetos (o RESTRICT de `block_media` → `media_assets` não pode
 * depender da ordem em que o cascade apaga).
 */
export async function cleanupMedia(t: AuthHarness): Promise<void> {
  const ids = (
    await t.db
      .select({ id: users.id })
      .from(users)
      .where(like(users.email, `%@${t.runId}.test.local`))
  ).map((row) => row.id);
  if (ids.length === 0) return;
  const media = (
    await t.db
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(inArray(mediaAssets.userId, ids))
  ).map((row) => row.id);
  if (media.length > 0) {
    await t.db.delete(outboxEvents).where(inArray(outboxEvents.aggregateId, media));
  }
  await t.db.delete(projects).where(inArray(projects.userId, ids));
}
