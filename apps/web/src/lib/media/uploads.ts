import { type QueryClient } from '@tanstack/react-query';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

import {
  ACCEPTED_IMAGE_FORMATS_LABEL,
  checkUploadIntent,
  type CreateUploadRequest,
  fileExtension,
  RAW_NOT_SUPPORTED_MESSAGE,
  VIDEO_NOT_AVAILABLE_MESSAGE,
} from '@casebook/contracts/media';

import { ApiError } from '../api/errors';
import { completeUpload, createUpload } from '../api/media';

import { upsertAsset } from './cache';
import { hashFile } from './hash';
import { uploadParts } from './multipart';

/**
 * - `waiting`: na fila local, atrás de outros arquivos
 * - `hashing`: calculando o SHA-256 (etapa `hashing` do design)
 * - `uploading`: enviando as partes (etapa `uploading`)
 * - `finishing`: partes enviadas, fechando o upload na API
 * - `duplicate`: o arquivo já estava na conta; nada foi enviado
 * - `failed` / `cancelled`: parou; `retryable` diz se dá para tentar de novo
 */
export type UploadStatus =
  'waiting' | 'hashing' | 'uploading' | 'finishing' | 'duplicate' | 'failed' | 'cancelled';

export interface UploadItem {
  /** Id local, só desta aba. */
  id: string;
  name: string;
  size: number;
  status: UploadStatus;
  /** 0 a 1 dentro da etapa atual. */
  progress: number;
  error?: string;
  retryable: boolean;
  /** Conhecido depois da intenção de upload. */
  mediaId?: string;
}

/** Arquivos enviados ao mesmo tempo; cada um manda até 4 partes em paralelo. */
const PARALLEL_FILES = 2;
/** Vídeo fica atrás de flag no servidor até a Sprint 6: recusado aqui antes de hashear. */
const VIDEO_ENABLED = false;

const store = createStore<{ items: UploadItem[] }>(() => ({ items: [] }));
const files = new Map<string, File>();
const controllers = new Map<string, AbortController>();
let running = 0;
let client: QueryClient | undefined;

export function useUploads(): UploadItem[] {
  return useStore(store, (state) => state.items);
}

/** Há upload em curso nesta aba (para o aviso ao sair da página). */
export function hasActiveUploads(items: UploadItem[]): boolean {
  return items.some((item) => isActive(item.status));
}

export function isActive(status: UploadStatus): boolean {
  return (
    status === 'waiting' || status === 'hashing' || status === 'uploading' || status === 'finishing'
  );
}

function patch(id: string, changes: Partial<UploadItem>): void {
  store.setState(({ items }) => ({
    items: items.map((item) => (item.id === id ? { ...item, ...changes } : item)),
  }));
}

function remove(id: string): void {
  files.delete(id);
  controllers.delete(id);
  store.setState(({ items }) => ({ items: items.filter((item) => item.id !== id) }));
}

// O browser manda tipo vazio para extensões que o sistema não conhece (HEIC fora do macOS).
const MIME_BY_EXTENSION: Record<string, string> = {
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
};

function mimeOf(file: File): string {
  return file.type || (MIME_BY_EXTENSION[fileExtension(file.name)] ?? '');
}

/** Mesma regra da API (`checkUploadIntent`), para recusar antes de calcular o hash. */
function localProblem(file: File): string | undefined {
  if (file.size === 0) return 'O arquivo está vazio.';
  const check = checkUploadIntent(
    { filename: file.name, mime: mimeOf(file), size_bytes: file.size },
    { videoEnabled: VIDEO_ENABLED },
  );
  if (check.ok) return undefined;
  switch (check.reason) {
    case 'raw':
      return RAW_NOT_SUPPORTED_MESSAGE;
    case 'video_disabled':
      return VIDEO_NOT_AVAILABLE_MESSAGE;
    case 'too_large':
      return `O arquivo passa do limite de ${String(Math.round(check.maxBytes / 1024 / 1024))} MB.`;
    case 'unsupported_type':
      return `Formato não aceito. Envie ${ACCEPTED_IMAGE_FORMATS_LABEL}.`;
  }
}

/** Põe os arquivos na fila de envio. O que não passa na validação local já entra como falha. */
export function enqueueUploads(selected: readonly File[], queryClient: QueryClient): void {
  client = queryClient;
  const items = selected.map((file): UploadItem => {
    const id = crypto.randomUUID();
    const problem = localProblem(file);
    if (!problem) files.set(id, file);
    return {
      id,
      name: file.name,
      size: file.size,
      progress: 0,
      ...(problem
        ? { status: 'failed', error: problem, retryable: false }
        : { status: 'waiting', retryable: true }),
    };
  });
  store.setState((state) => ({ items: [...state.items, ...items] }));
  pump();
}

/** Cancela um envio em curso. Não chama `complete`: o GC da API limpa o multipart. */
export function cancelUpload(id: string): void {
  const controller = controllers.get(id);
  if (controller) controller.abort();
  else patch(id, { status: 'cancelled', progress: 0 });
}

export function retryUpload(id: string): void {
  if (!files.has(id)) return;
  store.setState(({ items }) => ({
    items: items.map((item) => {
      if (item.id !== id) return item;
      const { error: _error, ...rest } = item;
      return { ...rest, status: 'waiting', progress: 0 };
    }),
  }));
  pump();
}

/** Tira o item da lista (falha, cancelado ou aviso de duplicado já lido). */
export function dismissUpload(id: string): void {
  remove(id);
}

function pump(): void {
  while (running < PARALLEL_FILES) {
    const next = store
      .getState()
      .items.find((item) => item.status === 'waiting' && !controllers.has(item.id));
    if (!next) return;
    running++;
    void run(next.id).finally(() => {
      running--;
      pump();
    });
  }
}

async function run(id: string): Promise<void> {
  const file = files.get(id);
  const queryClient = client;
  if (!file || !queryClient) return;
  const controller = new AbortController();
  controllers.set(id, controller);
  const { signal } = controller;

  try {
    patch(id, { status: 'hashing', progress: 0 });
    const sha256 = await hashFile(file, {
      signal,
      onProgress: (progress) => {
        patch(id, { progress });
      },
    });

    const request: CreateUploadRequest = {
      filename: file.name,
      mime: mimeOf(file),
      size_bytes: file.size,
      sha256,
    };
    const intent = await createUpload(request, signal);
    patch(id, { mediaId: intent.asset.id });

    if (intent.deduplicated || !intent.upload) {
      upsertAsset(queryClient, intent.asset);
      files.delete(id);
      patch(id, { status: 'duplicate', progress: 1, retryable: false });
      return;
    }

    patch(id, { status: 'uploading', progress: 0 });
    const parts = await uploadParts({
      file,
      partSize: intent.upload.part_size,
      parts: intent.upload.parts,
      signal,
      onProgress: (loaded, total) => {
        patch(id, { progress: total === 0 ? 1 : loaded / total });
      },
      // URLs vencidas no meio do envio: a mesma intenção, para um asset ainda
      // `pending`, devolve URLs novas do mesmo multipart.
      refreshUrls: async () => (await createUpload(request, signal)).upload?.parts ?? [],
    });

    patch(id, { status: 'finishing', progress: 1 });
    const asset = await completeUpload(intent.asset.id, { parts }, signal);
    upsertAsset(queryClient, asset);
    remove(id);
  } catch (error) {
    if (signal.aborted) {
      patch(id, { status: 'cancelled', progress: 0 });
    } else {
      patch(id, {
        status: 'failed',
        progress: 0,
        error:
          error instanceof ApiError
            ? error.message
            : 'Não foi possível enviar o arquivo. Confira sua conexão e tente de novo.',
      });
    }
  } finally {
    controllers.delete(id);
  }
}
