import { describe, expect, it } from 'vitest';

import { contentHash8, storageKeys } from './keys.js';

describe('storageKeys', () => {
  it('original: o/{userId}/{mediaId}', () => {
    expect(storageKeys.original('u1', 'm1')).toBe('o/u1/m1');
  });

  it('derivativo: m/{mediaId}/{width}-{hash8}.{fmt}, hash do conteúdo', () => {
    const hash = contentHash8(new TextEncoder().encode('abc'));
    expect(hash).toBe('ba7816bf');
    expect(
      storageKeys.derivative({ mediaId: 'm1', width: 640, contentHash8: hash, format: 'avif' }),
    ).toBe('m/m1/640-ba7816bf.avif');
  });

  it('recusa hash fora do formato', () => {
    expect(() =>
      storageKeys.derivative({ mediaId: 'm1', width: 640, contentHash8: 'xyz', format: 'webp' }),
    ).toThrow();
  });
});
