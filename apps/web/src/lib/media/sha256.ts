import { createSHA256 } from 'hash-wasm';

/** Fatia lida por vez. O arquivo nunca fica inteiro na memória. */
export const HASH_CHUNK_BYTES = 8 * 1024 * 1024;

export interface HashOptions {
  chunkBytes?: number;
  /** Bytes já processados, a cada fatia. */
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * SHA-256 incremental de um arquivo, em hexadecimal: lê em fatias de 8 MB
 * (`Blob.slice`) e alimenta o hash aos poucos. `crypto.subtle.digest` não
 * serve: exige o conteúdo inteiro num `ArrayBuffer`, e os vídeos da Sprint 6
 * chegam a 2 GB.
 */
export async function sha256Incremental(blob: Blob, options: HashOptions = {}): Promise<string> {
  const chunkBytes = options.chunkBytes ?? HASH_CHUNK_BYTES;
  const hasher = await createSHA256();
  hasher.init();
  for (let offset = 0; offset < blob.size; offset += chunkBytes) {
    options.signal?.throwIfAborted();
    const chunk = await blob.slice(offset, offset + chunkBytes).arrayBuffer();
    hasher.update(new Uint8Array(chunk));
    options.onProgress?.(Math.min(offset + chunkBytes, blob.size), blob.size);
  }
  options.signal?.throwIfAborted();
  return hasher.digest('hex');
}
