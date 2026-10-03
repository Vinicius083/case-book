import {
  type CompleteUploadRequest,
  type CreateUploadRequest,
  type CreateUploadResponse,
  type MediaAssetDetailResponse,
  type MediaAssetResponse,
  type MediaInUseProblem,
  mediaInUseProblemSchema,
  type MediaKind,
  type MediaListResponse,
  MEDIA_PROBLEM_TYPES,
  type MediaState,
  type UpdateMediaInput,
} from '@casebook/contracts/media';

import { apiFetch } from './client';
import { ApiError } from './errors';

export interface MediaFilters {
  kind?: MediaKind | undefined;
  state?: MediaState | undefined;
  q?: string | undefined;
}

/** Intenção de upload. Repetir para um asset ainda `pending` devolve URLs novas (retomada). */
export async function createUpload(
  body: CreateUploadRequest,
  signal?: AbortSignal,
): Promise<CreateUploadResponse> {
  const { data } = await apiFetch<CreateUploadResponse>('/media/uploads', {
    method: 'POST',
    body,
    ...(signal && { signal }),
  });
  return data;
}

export async function completeUpload(
  id: string,
  body: CompleteUploadRequest,
  signal?: AbortSignal,
): Promise<MediaAssetResponse> {
  const { data } = await apiFetch<MediaAssetResponse>(`/media/${id}/complete`, {
    method: 'POST',
    body,
    ...(signal && { signal }),
  });
  return data;
}

export async function retryMedia(id: string): Promise<MediaAssetResponse> {
  const { data } = await apiFetch<MediaAssetResponse>(`/media/${id}/retry`, { method: 'POST' });
  return data;
}

export async function listMedia(
  filters: MediaFilters,
  cursor: string | undefined,
  signal?: AbortSignal,
): Promise<MediaListResponse> {
  const params = new URLSearchParams({ limit: '24' });
  if (filters.kind) params.set('kind', filters.kind);
  if (filters.state) params.set('state', filters.state);
  if (filters.q) params.set('q', filters.q);
  if (cursor) params.set('cursor', cursor);
  const { data } = await apiFetch<MediaListResponse>(`/media?${params.toString()}`, {
    ...(signal && { signal }),
  });
  return data;
}

export async function getMedia(
  id: string,
  signal?: AbortSignal,
): Promise<MediaAssetDetailResponse> {
  const { data } = await apiFetch<MediaAssetDetailResponse>(`/media/${id}`, {
    ...(signal && { signal }),
  });
  return data;
}

export async function updateMedia(
  id: string,
  patch: UpdateMediaInput,
): Promise<MediaAssetResponse> {
  const { data } = await apiFetch<MediaAssetResponse>(`/media/${id}`, {
    method: 'PATCH',
    body: patch,
  });
  return data;
}

export type DeleteMediaResult = { deleted: true } | { deleted: false; inUse: MediaInUseProblem };

/**
 * Apaga o asset. Em uso por algum bloco e sem `confirm`, a API responde 409 com
 * os projetos afetados (RF-LIB-3): volta em `inUse`, para a tela pedir confirmação.
 */
export async function deleteMedia(id: string, confirm = false): Promise<DeleteMediaResult> {
  try {
    await apiFetch(`/media/${id}${confirm ? '?confirm=true' : ''}`, { method: 'DELETE' });
    return { deleted: true };
  } catch (error) {
    if (error instanceof ApiError && error.type === MEDIA_PROBLEM_TYPES.inUse) {
      const inUse = mediaInUseProblemSchema.safeParse(error.body);
      if (inUse.success) return { deleted: false, inUse: inUse.data };
    }
    throw error;
  }
}
