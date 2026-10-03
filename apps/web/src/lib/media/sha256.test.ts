import { createHash, randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { HASH_CHUNK_BYTES, sha256Incremental } from './sha256';

const reference = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

describe('sha256Incremental', () => {
  it.each([
    ['0 byte', 0],
    ['1 byte', 1],
    ['8 MB exatos', HASH_CHUNK_BYTES],
    ['8 MB + 1', HASH_CHUNK_BYTES + 1],
  ])('confere com o SHA-256 de referência: %s', async (_name, size) => {
    const data = randomBytes(size);
    const progress: number[] = [];
    const hash = await sha256Incremental(new Blob([data]), {
      onProgress: (loaded) => progress.push(loaded),
    });
    expect(hash).toBe(reference(data));
    // Uma fatia por 8 MB (ou pedaço): nunca o arquivo inteiro de uma vez acima disso.
    expect(progress).toHaveLength(Math.ceil(size / HASH_CHUNK_BYTES));
    expect(progress.at(-1) ?? 0).toBe(size);
  });

  it('lê em fatias: o resultado não depende do tamanho da fatia', async () => {
    const data = randomBytes(10_000);
    const whole = await sha256Incremental(new Blob([data]));
    const sliced = await sha256Incremental(new Blob([data]), { chunkBytes: 777 });
    expect(sliced).toBe(whole);
    expect(whole).toBe(reference(data));
  });

  it('cancelar interrompe entre as fatias', async () => {
    const controller = new AbortController();
    const hashing = sha256Incremental(new Blob([randomBytes(5000)]), {
      chunkBytes: 1000,
      signal: controller.signal,
      onProgress: () => {
        controller.abort();
      },
    });
    await expect(hashing).rejects.toMatchObject({ name: 'AbortError' });
  });
});
