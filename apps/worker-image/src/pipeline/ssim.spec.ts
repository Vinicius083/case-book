import { readFileSync } from 'node:fs';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { inlineSsim, SsimPool } from './ssim-pool.js';
import {
  ALPHA_BACKGROUND,
  alphaFromRaw,
  lumaFromRaw,
  measureEncoded,
  prepareFrame,
  prepareReference,
  ssim,
  ssimAgainst,
} from './ssim.js';

const dir = new URL('../../fixtures/test/ssim/', import.meta.url);
const { expected } = JSON.parse(readFileSync(new URL('expected.json', dir), 'utf8')) as {
  expected: Record<string, number>;
};

async function load(name: string) {
  const { data, info } = await sharp(new URL(name, dir).pathname)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return lumaFromRaw(data, info.width, info.height, info.channels);
}

describe('ssim', () => {
  // Pares gerados e medidos com o scikit-image (structural_similarity, janela
  // gaussiana σ=1,5, covariância populacional, data_range=255): a mesma variante.
  it.each(Object.entries(expected))('bate com o scikit-image: %s', async (name, value) => {
    const score = ssim(await load('base.png'), await load(`${name}.png`));
    expect(score).toBeCloseTo(value, 5);
  });

  it('é simétrico e ordena as degradações', async () => {
    const base = await load('base.png');
    const light = await load('noise-5.png');
    const heavy = await load('noise-15.png');
    // μx e σx² da referência ficam em float32; trocar os papéis muda o arredondamento.
    expect(ssim(base, light)).toBeCloseTo(ssim(light, base), 6);
    expect(ssim(base, light)).toBeGreaterThan(ssim(base, heavy));
  });

  it('a referência preparada uma vez serve a várias medições, com o mesmo resultado', async () => {
    const reference = prepareReference(await load('base.png'));
    for (const [name, value] of Object.entries(expected)) {
      expect(ssimAgainst(reference, await load(`${name}.png`))).toBeCloseTo(value, 5);
    }
  });

  it('compõe alfa sobre cinza médio: cor sob pixel transparente não conta', () => {
    const a = new Uint8Array([10, 20, 30, 0, 200, 200, 200, 255]);
    const b = new Uint8Array([250, 0, 90, 0, 200, 200, 200, 255]);
    const luma = lumaFromRaw(a, 2, 1, 4).data;
    expect(luma).toEqual(lumaFromRaw(b, 2, 1, 4).data);
    expect(luma[0]).toBe(ALPHA_BACKGROUND);
    expect(luma[1]).toBeCloseTo(200, 3);
  });

  it('alfa como imagem: só quando há canal, e sabe dizer se é todo opaco', () => {
    expect(alphaFromRaw(new Uint8Array(6), 2, 1, 3)).toBeUndefined();
    const opaque = alphaFromRaw(new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]), 2, 1, 4);
    expect(opaque?.opaque).toBe(true);
    const cut = alphaFromRaw(new Uint8Array([1, 2, 3, 0, 4, 5, 6, 255]), 2, 1, 4);
    expect(cut?.opaque).toBe(false);
    expect([...(cut?.image.data ?? [])]).toEqual([0, 255]);
  });

  it('recusa tamanhos diferentes', () => {
    const small = lumaFromRaw(new Uint8Array(16 * 16), 16, 16, 1);
    const big = lumaFromRaw(new Uint8Array(17 * 16), 17, 16, 1);
    expect(() => ssim(small, big)).toThrow();
  });
});

describe('medição de encodes', () => {
  /** Disco com borda suave sobre fundo transparente, textura por baixo. */
  const alphaFrame = (size: number) => {
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const d = Math.hypot(x - size / 2, y - size / 2);
        data[i] = 128 + 100 * Math.sin(x / 5);
        data[i + 1] = 128 + 100 * Math.cos(y / 7);
        data[i + 2] = (x * y) % 256;
        data[i + 3] = Math.max(0, Math.min(255, (size / 3 - d) * 16));
      }
    }
    return { data, width: size, height: size, channels: 4 };
  };
  const avif = (frame: ReturnType<typeof alphaFrame>, quality: number) =>
    sharp(frame.data, { raw: { width: frame.width, height: frame.height, channels: 4 } })
      .avif({ quality, effort: 2 })
      .toBuffer();

  it('sem transparência não há referência de alfa nem SSIM de alfa', async () => {
    const data = new Uint8Array(64 * 64 * 3).map((_, i) => (i * 7) % 256);
    const reference = prepareFrame({ data, width: 64, height: 64, channels: 3 });
    expect(reference.alpha).toBeUndefined();
    const png = await sharp(data, { raw: { width: 64, height: 64, channels: 3 } })
      .png()
      .toBuffer();
    const measured = await measureEncoded(reference, png, true);
    expect(measured.ssim).toBeCloseTo(1, 6);
    expect(measured.alphaSsim).toBeUndefined();
  });

  it('AVIF com transparência: o canal alfa é medido à parte e piora com a qualidade', async () => {
    const frame = alphaFrame(160);
    const reference = prepareFrame(frame);
    expect(reference.alpha).toBeDefined();
    const high = await measureEncoded(reference, await avif(frame, 90), true);
    const low = await measureEncoded(reference, await avif(frame, 20), true);
    expect(high.alphaSsim).toBeGreaterThan(0.98);
    expect(low.alphaSsim).toBeLessThan(high.alphaSsim ?? 0);
    expect(low.ssim).toBeLessThan(high.ssim);
    // Sem pedir, o alfa não é medido (WebP e JPEG).
    expect(
      (await measureEncoded(reference, await avif(frame, 90), false)).alphaSsim,
    ).toBeUndefined();
  });

  it('o pool de threads dá o mesmo resultado da medição na própria thread', async () => {
    const pool = new SsimPool(2);
    try {
      const frame = alphaFrame(200);
      const encodes = await Promise.all([30, 50, 70, 90].map((quality) => avif(frame, quality)));
      const [inlineRef, pooledRef] = await Promise.all([
        inlineSsim.prepare(frame),
        pool.prepare(frame),
      ]);
      const job = pool.forJob(1);
      const pooled = await Promise.all(encodes.map((data) => job.measure(pooledRef, data, true)));
      for (const [i, data] of encodes.entries()) {
        expect(pooled[i]).toEqual(await inlineSsim.measure(inlineRef, data, true));
      }
    } finally {
      await pool.close();
    }
  });

  it('erro na thread vira rejeição, e o pool segue servindo', async () => {
    const pool = new SsimPool(1);
    try {
      const frame = alphaFrame(64);
      const reference = await pool.prepare(frame);
      await expect(pool.measure(reference, Buffer.from('não é imagem'), false)).rejects.toThrow(
        /SSIM/,
      );
      expect((await pool.measure(reference, await avif(frame, 80), false)).ssim).toBeGreaterThan(
        0.5,
      );
    } finally {
      await pool.close();
    }
  });
});
