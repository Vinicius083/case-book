import type { HandleAvailability } from '@casebook/contracts/handle';
import type {
  ChangePasswordInput,
  MeResponse,
  UpdateProfileInput,
} from '@casebook/contracts/profile';

import { apiFetch, type ApiResponse } from './client';

/** `/me` com o ETag do perfil, que volta em `If-Match` na edição. */
export interface Me {
  me: MeResponse;
  etag: string;
}

function toMe({ data, headers }: ApiResponse<MeResponse>): Me {
  return { me: data, etag: headers.get('etag') ?? '' };
}

export async function fetchMe(signal?: AbortSignal): Promise<Me> {
  return toMe(await apiFetch<MeResponse>('/me', { ...(signal && { signal }) }));
}

export async function updateProfile(patch: UpdateProfileInput, etag: string): Promise<Me> {
  return toMe(
    await apiFetch<MeResponse>('/me/profile', {
      method: 'PATCH',
      body: patch,
      headers: { 'if-match': etag },
    }),
  );
}

export async function changeHandle(handle: string): Promise<Me> {
  return toMe(await apiFetch<MeResponse>('/me/handle', { method: 'PATCH', body: { handle } }));
}

export async function changePassword(input: ChangePasswordInput): Promise<void> {
  await apiFetch('/me/password', { method: 'PATCH', body: input });
}

export async function fetchHandleAvailability(
  handle: string,
  signal?: AbortSignal,
): Promise<HandleAvailability> {
  const { data } = await apiFetch<HandleAvailability>(
    `/handles/${encodeURIComponent(handle)}/availability`,
    // Rota pública: um 401 aqui não é sessão vencida.
    { refreshOn401: false, ...(signal && { signal }) },
  );
  return data;
}
