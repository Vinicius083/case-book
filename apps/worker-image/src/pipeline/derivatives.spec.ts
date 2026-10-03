import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { alphaPng, p3Png, syntheticJpeg } from '../../test/images.js';

import {
  type DerivativeFormat,
  type Frame,
  generateDerivatives,
  normalizedFrame,
  planWidths,
  QUALITY,
  referenceWidth,
  SEARCH_STEPS,
  type Source,
  SSIM_TARGET,
} from './derivatives.js';
import { describeIcc } from './icc.js';
import { inlineSsim, type SsimRunner } from './ssim-pool.js';
import { type Measurement } from './ssim.js';

describe('planWidths', () => {
  it('nunca faz upscale; a largura original entra quando é menor que 3840', () => {
    expect(planWidths(6000)).toEqual([320, 640, 1024, 1600, 2400, 3840]);
    expect(planWidths(800)).toEqual([320, 640, 800]);
    expect(planWidths(1600)).toEqual([320, 640, 1024, 1600]);
    expect(planWidths(200)).toEqual([200]);
  });

  it('referência em 1600, ou na maior disponível', () => {
    expect(referenceWidth(planWidths(6000))).toBe(1600);
    expect(referenceWidth(planWidths(800))).toBe(800);
  });
});

describe('generateDerivatives', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'derivatives-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const sourceFrom = async (name: string, data: Buffer): Promise<Source> => {
    const path = join(dir, name);
    await writeFile(path, data);
    const meta = await sharp(path).metadata();
    return {
      path,
      width: meta.width,
      height: meta.height,
      output: describeIcc(meta.icc).wideGamut ? 'p3' : 'srgb',
      grey: false,
    };
  };

  it('um passe: todo derivativo sai de um quadro gerado do original, nunca de outro derivativo', async () => {
    const source = await sourceFrom('foto.jpg', await syntheticJpeg(800, 600));
    const frames = new WeakSet<Frame>();
    const calls: { path: string; width: number }[] = [];
    const { derivatives } = await generateDerivatives(source, {
      ssim: inlineSsim,
      frameFor: async (src, width) => {
        calls.push({ path: src.path, width });
        const frame = await normalizedFrame(src, width);
        frames.add(frame);
        return frame;
      },
    });
    // Um quadro por largura, todos lidos do arquivo original.
    expect(calls.map((c) => c.width).sort((a, b) => a - b)).toEqual([320, 640, 800]);
    expect(new Set(calls.map((c) => c.path))).toEqual(new Set([source.path]));
    // E cada derivativo tem a largura de um desses quadros (não foi reduzido de outro).
    expect(new Set(derivatives.map((d) => d.width))).toEqual(new Set([320, 640, 800]));
  });

  it('imagem de 800px não gera nada acima de 800; AVIF e WebP em cada largura, JPEG uma vez', async () => {
    const source = await sourceFrom('pequena.jpg', await syntheticJpeg(800, 533));
    const { derivatives, stats } = await generateDerivatives(source, { ssim: inlineSsim });
    expect(Math.max(...derivatives.map((d) => d.width))).toBe(800);
    expect(derivatives.filter((d) => d.format === 'jpeg').map((d) => d.width)).toEqual([800]);
    for (const width of [320, 640, 800]) {
      expect(derivatives.filter((d) => d.width === width && d.format !== 'jpeg')).toHaveLength(2);
    }
    for (const d of derivatives) {
      expect(d.quality).toBeGreaterThanOrEqual(QUALITY[d.format].min);
      // A foto sintética tem ruído fino: o JPEG pode precisar do teto do formato.
      expect(d.quality).toBeLessThanOrEqual(QUALITY[d.format].ceiling);
      expect(d.ssim).toBeGreaterThanOrEqual(SSIM_TARGET);
      expect(d.targetMet).toBe(true);
      expect(d.alphaSsim).toBeUndefined();
    }
    expect(stats.targetMissed).toBe(0);
  });

  it('larguras em paralelo dão o mesmo resultado que em série', async () => {
    const source = await sourceFrom('paralelo.jpg', await syntheticJpeg(1200, 800));
    const serial = await generateDerivatives(source, { ssim: inlineSsim });
    const parallel = await generateDerivatives(source, { ssim: inlineSsim, parallelWidths: 3 });
    const summary = (ds: typeof serial.derivatives) =>
      ds.map((d) => [d.format, d.width, d.quality, d.ssim, d.data.length]);
    expect(summary(parallel.derivatives)).toEqual(summary(serial.derivatives));
  });

  describe('busca de qualidade (encoder e SSIM simulados)', () => {
    type Curve = (format: DerivativeFormat, width: number, quality: number) => Partial<Measurement>;

    /**
     * Fonte de 2000px (larguras 320, 640, 1024, 1600 e 2000; referência em 1600)
     * com quadros vazios; o "encode" só anota formato, largura e qualidade, e o
     * SSIM vem da curva do teste.
     */
    const simulate = async (curve: Curve) => {
      const calls: { format: DerivativeFormat; width: number; quality: number }[] = [];
      const ssim: SsimRunner = {
        prepare: (frame) => {
          const empty = new Float32Array(0);
          const luma = {
            width: frame.width,
            height: frame.height,
            luma: empty,
            mean: empty,
            variance: empty,
          };
          return Promise.resolve({ luma, alpha: undefined });
        },
        measure: (_reference, encoded) => {
          const call = JSON.parse(Buffer.from(encoded).toString()) as (typeof calls)[number];
          calls.push(call);
          const measured = curve(call.format, call.width, call.quality);
          return Promise.resolve({ ssim: measured.ssim ?? 1, alphaSsim: measured.alphaSsim });
        },
      };
      const result = await generateDerivatives(
        { path: 'inexistente', width: 2000, height: 20, output: 'srgb', grey: false },
        {
          ssim,
          frameFor: (_source, width) =>
            Promise.resolve({
              width,
              height: 20,
              channels: 3,
              data: Buffer.alloc(0),
              output: 'srgb',
            }),
          encode: (frame, format, quality) =>
            Promise.resolve(Buffer.from(JSON.stringify({ format, width: frame.width, quality }))),
        },
      );
      const tried = (format: DerivativeFormat, width: number) =>
        calls.filter((c) => c.format === format && c.width === width).map((c) => c.quality);
      const chosen = (format: DerivativeFormat, width: number) => {
        const found = result.derivatives.find((d) => d.format === format && d.width === width);
        if (!found) throw new Error(`sem derivativo ${format} ${String(width)}`);
        return found;
      };
      return { ...result, tried, chosen };
    };
    const passFrom = (threshold: number) => (quality: number) =>
      quality >= threshold ? 0.99 : 0.97;

    it('referência: busca binária na faixa de cada formato, em até 5 passos, só em 1600', async () => {
      const { tried, chosen, stats } = await simulate((_format, _width, quality) => ({
        ssim: passFrom(80)(quality),
      }));
      expect(tried('avif', 1600)).toEqual([73, 82, 78, 80, 79]);
      expect(tried('webp', 1600)).toEqual([85, 80, 77, 79]);
      expect(tried('jpeg', 1600)).toEqual([85, 80, 77, 79]);
      for (const format of ['avif', 'webp', 'jpeg'] as const) {
        expect(tried(format, 1600).length).toBeLessThanOrEqual(SEARCH_STEPS);
        expect(chosen(format, 1600)).toMatchObject({ quality: 80, targetMet: true });
      }
      expect(stats.referenceQuality).toEqual({ avif: 80, webp: 80, jpeg: 80 });
      // Nas outras larguras, um encode só, na qualidade da referência. JPEG só em 1600.
      for (const width of [320, 640, 1024, 2000]) {
        expect(tried('avif', width)).toEqual([80]);
        expect(tried('webp', width)).toEqual([80]);
        expect(tried('jpeg', width)).toEqual([]);
      }
      expect(stats.encodes).toBe(5 + 4 + 4 + 8);
      expect(stats.targetMissed).toBe(0);
    });

    it('a menor qualidade da faixa já serve: fica nela', async () => {
      const { chosen } = await simulate(() => ({ ssim: 0.999 }));
      // AVIF: 36 valores na faixa e 5 passos (que resolvem 31) — para a 1 ponto do mínimo.
      expect(chosen('avif', 1600).quality).toBe(QUALITY.avif.min + 1);
      expect(chosen('webp', 1600).quality).toBe(QUALITY.webp.min);
      expect(chosen('jpeg', 1600).quality).toBe(QUALITY.jpeg.min);
    });

    it('outras larguras: abaixo do alvo sobe 5 pontos, até 2 vezes; depois o máximo da faixa', async () => {
      const needs: Record<number, number> = { 320: 84, 640: 90, 1024: 93, 1600: 80, 2000: 80 };
      const { tried, chosen } = await simulate((_format, width, quality) => ({
        ssim: passFrom(needs[width] ?? 80)(quality),
      }));
      expect(tried('webp', 320)).toEqual([80, 85]);
      expect(tried('webp', 640)).toEqual([80, 85, 90]);
      expect(tried('webp', 1024)).toEqual([80, 85, 90, 95]);
      expect(chosen('webp', 1024)).toMatchObject({ quality: 95, targetMet: true });
      // AVIF: o máximo da faixa é 90, já tentado na segunda subida; daí o teto.
      expect(tried('avif', 1024)).toEqual([80, 85, 90, 98]);
      expect(chosen('avif', 1024)).toMatchObject({ quality: 98, targetMet: true });
    });

    it('teto: nem o máximo da faixa alcança → um último encode no máximo do formato', async () => {
      // JPEG só alcança em 100; WebP nunca alcança; AVIF normal.
      const { tried, chosen, stats } = await simulate((format, _width, quality) => {
        if (format === 'jpeg') return { ssim: passFrom(100)(quality) };
        if (format === 'webp') return { ssim: 0.9 + quality / 2000 };
        return { ssim: passFrom(60)(quality) };
      });
      expect(tried('jpeg', 1600)).toEqual([85, 91, 94, 95, 100]);
      expect(chosen('jpeg', 1600)).toMatchObject({ quality: 100, targetMet: true });

      expect(tried('webp', 1600)).toEqual([85, 91, 94, 95, 100]);
      // Aceito com o SSIM real e marcado; nas outras larguras, direto ao teto.
      for (const width of [320, 640, 1024, 1600, 2000]) {
        expect(chosen('webp', width)).toMatchObject({ quality: 100, targetMet: false });
        expect(chosen('webp', width).ssim).toBeCloseTo(0.95, 10);
      }
      expect(tried('webp', 320)).toEqual([100]);
      expect(stats.targetMissed).toBe(5);
      expect(stats.referenceQuality).toMatchObject({ jpeg: 100, webp: 100 });
    });

    it('AVIF com transparência: vale o pior entre a imagem composta e o canal alfa', async () => {
      const { chosen, tried } = await simulate((format, _width, quality) => ({
        ssim: 0.99,
        // O alfa só fica bom a partir de 85.
        alphaSsim: format === 'avif' ? passFrom(85)(quality) : undefined,
      }));
      expect(tried('avif', 1600)).toEqual([73, 82, 87, 85, 84]);
      expect(chosen('avif', 1600)).toMatchObject({ quality: 85, ssim: 0.99, alphaSsim: 0.99 });
      expect(chosen('webp', 1600)).toMatchObject({
        quality: QUALITY.webp.min,
        alphaSsim: undefined,
      });
    });

    it('falha num encode interrompe a geração', async () => {
      await expect(
        generateDerivatives(
          { path: 'inexistente', width: 2000, height: 20, output: 'srgb', grey: false },
          {
            ssim: inlineSsim,
            frameFor: (_source, width) =>
              Promise.resolve({
                width,
                height: 20,
                channels: 3,
                data: Buffer.alloc(0),
                output: 'srgb',
              }),
            encode: () => Promise.reject(new Error('encoder quebrou')),
          },
        ),
      ).rejects.toThrow('encoder quebrou');
    });
  });

  it('PNG com transparência: AVIF e WebP mantêm o alfa, JPEG sai achatado sobre cinza médio', async () => {
    const source = await sourceFrom('alfa.png', await alphaPng(400));
    const { derivatives } = await generateDerivatives(source, { ssim: inlineSsim });
    for (const d of derivatives) {
      const meta = await sharp(d.data).metadata();
      expect(meta.hasAlpha, `${d.format} ${String(d.width)}`).toBe(d.format !== 'jpeg');
      // O alfa só é medido à parte no AVIF, o único que o codifica com perda.
      if (d.format === 'avif') expect(d.alphaSsim).toBeGreaterThanOrEqual(d.ssim);
      else expect(d.alphaSsim).toBeUndefined();
      expect(d.targetMet).toBe(true);
    }
    const jpeg = derivatives.find((d) => d.format === 'jpeg');
    // Canto do JPEG: era transparente, agora #808080.
    const { data } = await sharp(jpeg?.data)
      .extract({ left: 0, top: 0, width: 4, height: 4 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (const value of data.subarray(0, 3)) {
      expect(value).toBeGreaterThan(124);
      expect(value).toBeLessThan(132);
    }
  });

  it('fonte Display P3: derivativos mantêm o perfil P3 e as cores fora do sRGB', async () => {
    const source = await sourceFrom('p3.png', await p3Png(480, 320));
    expect(source.output).toBe('p3');
    const { derivatives } = await generateDerivatives(source, { ssim: inlineSsim });
    for (const d of derivatives) {
      const meta = await sharp(d.data).metadata();
      expect(describeIcc(meta.icc).wideGamut, `${d.format} ${String(d.width)}`).toBe(true);
      // Faixa de verde P3 puro (topo): sem recorte para o sRGB, o verde decodificado
      // (sem conversão) continua perto de (0, 255, 0) — em sRGB recortado seria ~(117, 251, 76).
      const { data } = await sharp(d.data, { ignoreIcc: true })
        .extract({ left: 0, top: 0, width: 8, height: 8 })
        .raw()
        .toBuffer({ resolveWithObject: true });
      const [r = 0, g = 0, b = 0] = data;
      expect(r, `${d.format} ${String(d.width)} R`).toBeLessThan(25);
      expect(g).toBeGreaterThan(235);
      expect(b).toBeLessThan(25);
    }
  });

  it('fonte sRGB: saída sRGB', async () => {
    const source = await sourceFrom('srgb.jpg', await syntheticJpeg(400, 300));
    const { derivatives } = await generateDerivatives(source, { ssim: inlineSsim });
    for (const d of derivatives) {
      expect(describeIcc((await sharp(d.data).metadata()).icc).wideGamut).toBe(false);
    }
  });
});
