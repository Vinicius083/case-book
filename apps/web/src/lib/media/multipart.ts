/** Uma parte a enviar: número (a partir de 1) e a URL presigned do PUT. */
export interface PartTarget {
  part_number: number;
  url: string;
}

export interface UploadedPart {
  part_number: number;
  etag: string;
}

/** Falha do PUT de uma parte. `status` 0 = sem resposta (rede). */
export class PartUploadError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'PartUploadError';
  }
}

export type PutPart = (
  url: string,
  body: Blob,
  options: { signal: AbortSignal; onProgress: (loaded: number) => void },
) => Promise<{ etag: string }>;

export interface UploadPartsOptions {
  file: Blob;
  partSize: number;
  parts: readonly PartTarget[];
  /** Partes em paralelo. Padrão: 4. */
  concurrency?: number;
  /** Tentativas por parte. Padrão: 3. */
  attempts?: number;
  signal?: AbortSignal;
  /** Bytes enviados somando todas as partes. Volta atrás quando uma parte recomeça. */
  onProgress?: (loaded: number, total: number) => void;
  /** URLs novas para o mesmo upload, quando as atuais expiram (403). */
  refreshUrls?: () => Promise<readonly PartTarget[]>;
  /** Injetáveis nos testes. */
  put?: PutPart;
  sleep?: (ms: number) => Promise<void>;
}

export const UPLOAD_CONCURRENCY = 4;
export const PART_ATTEMPTS = 3;
const BACKOFF_MS = 500;

/**
 * Envia as partes de um multipart direto ao storage: até 4 em paralelo, cada
 * uma com as suas tentativas (backoff exponencial). A falha de uma parte não
 * mexe nas outras; só quando ela esgota as tentativas o upload inteiro para.
 * Cancelar (`signal`) aborta os PUTs em andamento.
 */
export async function uploadParts(options: UploadPartsOptions): Promise<UploadedPart[]> {
  const { file, partSize } = options;
  const put = options.put ?? putWithXhr;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const attempts = options.attempts ?? PART_ATTEMPTS;

  // Aborta tudo na primeira parte que desiste, e segue o cancelamento de fora.
  const abort = new AbortController();
  const onOuterAbort = () => {
    abort.abort(options.signal?.reason);
  };
  if (options.signal?.aborted) onOuterAbort();
  options.signal?.addEventListener('abort', onOuterAbort);

  const urls = new Map(options.parts.map((part) => [part.part_number, part.url]));
  let refreshing: Promise<void> | undefined;
  const refreshUrls = (expired: string, partNumber: number): Promise<void> => {
    // Outra parte já renovou enquanto esta falhava: a URL dela já é outra.
    if (urls.get(partNumber) !== expired) return Promise.resolve();
    refreshing ??= (async () => {
      const fresh = await options.refreshUrls?.();
      for (const part of fresh ?? []) urls.set(part.part_number, part.url);
    })().finally(() => {
      refreshing = undefined;
    });
    return refreshing;
  };

  const loaded = new Map<number, number>();
  const report = (partNumber: number, bytes: number) => {
    loaded.set(partNumber, bytes);
    let sum = 0;
    for (const value of loaded.values()) sum += value;
    options.onProgress?.(sum, file.size);
  };

  const uploadOne = async (partNumber: number): Promise<UploadedPart> => {
    const start = (partNumber - 1) * partSize;
    const body = file.slice(start, start + partSize);
    for (let attempt = 1; ; attempt++) {
      abort.signal.throwIfAborted();
      const url = urls.get(partNumber);
      if (!url) throw new PartUploadError(0, `Parte ${String(partNumber)} sem URL de envio`);
      try {
        const { etag } = await put(url, body, {
          signal: abort.signal,
          onProgress: (bytes) => {
            report(partNumber, bytes);
          },
        });
        report(partNumber, body.size);
        return { part_number: partNumber, etag };
      } catch (error) {
        report(partNumber, 0);
        if (abort.signal.aborted || attempt >= attempts) throw error;
        if (error instanceof PartUploadError && error.status === 403 && options.refreshUrls) {
          await refreshUrls(url, partNumber);
        } else {
          await sleep(BACKOFF_MS * 2 ** (attempt - 1));
        }
      }
    }
  };

  const queue = options.parts.map((part) => part.part_number);
  const done: UploadedPart[] = [];
  const lane = async () => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      done.push(await uploadOne(next));
    }
  };
  try {
    await Promise.all(
      Array.from(
        { length: Math.min(options.concurrency ?? UPLOAD_CONCURRENCY, queue.length) },
        () =>
          lane().catch((error: unknown) => {
            abort.abort(error);
            throw error;
          }),
      ),
    );
  } finally {
    options.signal?.removeEventListener('abort', onOuterAbort);
  }
  return done.sort((a, b) => a.part_number - b.part_number);
}

/** PUT com `XMLHttpRequest`: o `fetch` não informa o progresso do envio. */
const putWithXhr: PutPart = (url, body, { signal, onProgress }) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const onAbort = () => {
      xhr.abort();
    };
    const settle = (fn: () => void) => {
      signal.removeEventListener('abort', onAbort);
      fn();
    };
    xhr.open('PUT', url);
    xhr.upload.onprogress = (event) => {
      onProgress(event.loaded);
    };
    xhr.onload = () => {
      settle(() => {
        const etag = xhr.getResponseHeader('etag');
        if (xhr.status >= 200 && xhr.status < 300 && etag) resolve({ etag });
        else reject(new PartUploadError(xhr.status, `O storage respondeu ${String(xhr.status)}`));
      });
    };
    xhr.onerror = () => {
      settle(() => {
        reject(new PartUploadError(0, 'Falha de rede ao enviar o arquivo'));
      });
    };
    xhr.onabort = () => {
      settle(() => {
        reject(new DOMException('Envio cancelado', 'AbortError'));
      });
    };
    if (signal.aborted) {
      onAbort();
      reject(new DOMException('Envio cancelado', 'AbortError'));
      return;
    }
    signal.addEventListener('abort', onAbort);
    xhr.send(body);
  });
