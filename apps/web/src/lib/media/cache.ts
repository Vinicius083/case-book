import { type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

import {
  type MediaAssetDetailResponse,
  type MediaAssetResponse,
  type MediaEvent,
  type MediaListResponse,
} from '@casebook/contracts/media';

import { getMedia, type MediaFilters } from '../api/media';

export const mediaKeys = {
  all: ['media'] as const,
  lists: () => ['media', 'list'] as const,
  list: (filters: MediaFilters) => ['media', 'list', filters] as const,
  detail: (id: string) => ['media', 'detail', id] as const,
};

type ListData = InfiniteData<MediaListResponse, string | undefined>;

/** Etapa e progresso do processamento no servidor, por mídia (vêm só pelos eventos). */
export interface ServerProgress {
  stage: NonNullable<MediaEvent['stage']>;
  progress: number | null;
}

const progressStore = createStore<Record<string, ServerProgress>>(() => ({}));

export function useServerProgress(mediaId: string): ServerProgress | undefined {
  return useStore(progressStore, (state) => state[mediaId]);
}

function matches(asset: MediaAssetResponse, filters: MediaFilters): boolean {
  if (filters.kind && asset.kind !== filters.kind) return false;
  if (filters.state && asset.state !== filters.state) return false;
  if (filters.q && !asset.filename.toLowerCase().includes(filters.q.toLowerCase())) return false;
  return true;
}

function listFields(asset: MediaAssetResponse | MediaAssetDetailResponse): MediaAssetResponse {
  const { derivatives: _derivatives, exif: _exif, ...fields } = asset as MediaAssetDetailResponse;
  return fields;
}

/**
 * Põe o asset nas listas em cache: troca no lugar se já está lá; se não, entra
 * no topo das listas cujo filtro ele atende. Quem deixa de atender o filtro sai.
 */
export function upsertAsset(
  queryClient: QueryClient,
  asset: MediaAssetResponse | MediaAssetDetailResponse,
): void {
  const item = listFields(asset);
  for (const [key, data] of queryClient.getQueriesData<ListData>({ queryKey: mediaKeys.lists() })) {
    if (!data) continue;
    const filters = (key[2] ?? {}) as MediaFilters;
    const present = data.pages.some((page) => page.items.some((it) => it.id === item.id));
    const keep = matches(item, filters);
    const pages = data.pages.map((page, index) => {
      const items = page.items.flatMap((it) => (it.id === item.id ? (keep ? [item] : []) : [it]));
      return index === 0 && !present && keep
        ? { ...page, items: [item, ...items] }
        : { ...page, items };
    });
    queryClient.setQueryData<ListData>(key, { ...data, pages });
  }
  if ('derivatives' in asset) queryClient.setQueryData(mediaKeys.detail(asset.id), asset);
}

export function removeAsset(queryClient: QueryClient, id: string): void {
  queryClient.setQueriesData<ListData>({ queryKey: mediaKeys.lists() }, (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.filter((item) => item.id !== id),
          })),
        }
      : data,
  );
  queryClient.removeQueries({ queryKey: mediaKeys.detail(id) });
}

function findAsset(queryClient: QueryClient, id: string): MediaAssetResponse | undefined {
  for (const [, data] of queryClient.getQueriesData<ListData>({ queryKey: mediaKeys.lists() })) {
    for (const page of data?.pages ?? []) {
      const found = page.items.find((item) => item.id === id);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Aplica um evento do servidor ao cache, sem refazer a lista: estado e mensagem
 * de erro vão direto no item; etapa e progresso, na store de progresso. Em
 * `ready` e `failed` busca só aquele asset, que agora tem miniatura, dimensões e
 * paleta.
 */
export function applyMediaEvent(queryClient: QueryClient, event: MediaEvent): void {
  const { [event.media_id]: _previous, ...others } = progressStore.getState();
  progressStore.setState(
    event.stage
      ? { ...others, [event.media_id]: { stage: event.stage, progress: event.progress } }
      : others,
    true,
  );

  const current = findAsset(queryClient, event.media_id);
  if (current) {
    upsertAsset(queryClient, {
      ...current,
      state: event.state,
      error_message: event.error_message,
      updated_at: event.at,
    });
  }
  if (event.state === 'ready' || event.state === 'failed') {
    void getMedia(event.media_id)
      .then((detail) => {
        upsertAsset(queryClient, detail);
      })
      // Sem o detalhe, o item fica com o estado do evento; a próxima busca da lista completa.
      .catch(() => undefined);
  }
}
