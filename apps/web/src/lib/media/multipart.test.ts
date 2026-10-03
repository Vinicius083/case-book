import { describe, expect, it } from 'vitest';

import { type PartTarget, PartUploadError, type PutPart, uploadParts } from './multipart';

const PART = 100;
const file = (parts: number, lastBytes = PART) =>
  new Blob([new Uint8Array((parts - 1) * PART + lastBytes)]);
const targets = (count: number, prefix = 'https://storage/p'): PartTarget[] =>
  Array.from({ length: count }, (_, i) => ({
    part_number: i + 1,
    url: `${prefix}${String(i + 1)}`,
  }));
const partOf = (url: string) => Number(/(\d+)$/.exec(url)?.[1]);
const noSleep = () => Promise.resolve();

describe('uploadParts', () => {
  it('a falha de uma parte, com sucesso no retry, não reinicia as outras', async () => {
    const calls = new Map<number, number>();
    const put: PutPart = (url, body, { onProgress }) => {
      const part = partOf(url);
      const attempt = (calls.get(part) ?? 0) + 1;
      calls.set(part, attempt);
      onProgress(body.size / 2);
      if (part === 3 && attempt === 1) return Promise.reject(new PartUploadError(500, 'falhou'));
      return Promise.resolve({ etag: `"etag-${String(part)}"` });
    };
    const sleeps: number[] = [];
    const result = await uploadParts({
      file: file(6),
      partSize: PART,
      parts: targets(6),
      put,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });

    expect(Object.fromEntries(calls)).toEqual({ 1: 1, 2: 1, 3: 2, 4: 1, 5: 1, 6: 1 });
    expect(sleeps).toEqual([500]);
    expect(result).toEqual(
      [1, 2, 3, 4, 5, 6].map((n) => ({ part_number: n, etag: `"etag-${String(n)}"` })),
    );
  });

  it('no máximo 4 partes em paralelo; progresso agregado por bytes', async () => {
    let active = 0;
    let peak = 0;
    const progress: number[] = [];
    const put: PutPart = async (_url, body, { onProgress }) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      onProgress(body.size);
      active--;
      return { etag: '"e"' };
    };
    await uploadParts({
      file: file(10, 40),
      partSize: PART,
      parts: targets(10),
      put,
      onProgress: (loaded, total) => {
        expect(total).toBe(940);
        progress.push(loaded);
      },
    });
    expect(peak).toBe(4);
    expect(progress.at(-1)).toBe(940);
    expect(Math.max(...progress)).toBe(940);
  });

  it('esgotadas as 3 tentativas de uma parte, o upload falha e as outras são abortadas', async () => {
    const calls = new Map<number, number>();
    const aborted: number[] = [];
    const put: PutPart = (url, _body, { signal }) => {
      const part = partOf(url);
      calls.set(part, (calls.get(part) ?? 0) + 1);
      if (part === 1) return Promise.reject(new PartUploadError(0, 'rede'));
      // As demais ficam penduradas até serem abortadas.
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborted.push(part);
          reject(new DOMException('abortado', 'AbortError'));
        });
      });
    };
    await expect(
      uploadParts({ file: file(3), partSize: PART, parts: targets(3), put, sleep: noSleep }),
    ).rejects.toMatchObject({ name: 'PartUploadError', status: 0 });
    expect(calls.get(1)).toBe(3);
    expect(aborted.sort()).toEqual([2, 3]);
  });

  it('URL expirada (403): pede URLs novas uma vez e segue de onde parou', async () => {
    let refreshes = 0;
    const used: string[] = [];
    const put: PutPart = (url) => {
      used.push(url);
      if (url.startsWith('https://storage/velha')) {
        return Promise.reject(new PartUploadError(403, 'expirou'));
      }
      return Promise.resolve({ etag: `"${url}"` });
    };
    const result = await uploadParts({
      file: file(3),
      partSize: PART,
      parts: targets(3, 'https://storage/velha'),
      put,
      sleep: noSleep,
      refreshUrls: () => {
        refreshes++;
        return Promise.resolve(targets(3, 'https://storage/nova'));
      },
    });
    expect(refreshes).toBe(1);
    expect(result.map((part) => part.etag)).toEqual(
      [1, 2, 3].map((n) => `"https://storage/nova${String(n)}"`),
    );
    expect(used.filter((url) => url.includes('nova'))).toHaveLength(3);
  });

  it('cancelar aborta os envios e rejeita com AbortError', async () => {
    const controller = new AbortController();
    const put: PutPart = (_url, _body, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new DOMException('abortado', 'AbortError'));
        });
      });
    const uploading = uploadParts({
      file: file(2),
      partSize: PART,
      parts: targets(2),
      put,
      signal: controller.signal,
    });
    controller.abort();
    await expect(uploading).rejects.toMatchObject({ name: 'AbortError' });
  });
});
