import type { HashReply, HashRequest } from './hash.worker';

/**
 * SHA-256 do arquivo num Web Worker, com progresso. Cancelar (`signal`) encerra
 * o worker na hora.
 */
export function hashFile(
  file: Blob,
  options: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./hash.worker.ts', import.meta.url), { type: 'module' });
    const finish = (settle: () => void) => {
      worker.terminate();
      options.signal?.removeEventListener('abort', onAbort);
      settle();
    };
    const onAbort = () => {
      finish(() => {
        reject(new DOMException('Hash cancelado', 'AbortError'));
      });
    };
    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    options.signal?.addEventListener('abort', onAbort);

    worker.onmessage = (event: MessageEvent<HashReply>) => {
      const reply = event.data;
      if (reply.type === 'progress') {
        options.onProgress?.(reply.total === 0 ? 1 : reply.loaded / reply.total);
      } else if (reply.type === 'done') {
        finish(() => {
          resolve(reply.sha256);
        });
      } else {
        finish(() => {
          reject(new Error(reply.message));
        });
      }
    };
    worker.onerror = (event) => {
      finish(() => {
        reject(new Error(event.message || 'Falha ao calcular o hash do arquivo'));
      });
    };
    worker.postMessage({ file } satisfies HashRequest);
  });
}
