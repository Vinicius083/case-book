import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { generateDerivatives } from '../src/pipeline/derivatives.js';
import { decodeHeic, heifDecoderFromEnv } from '../src/pipeline/heic.js';
import { describeIcc } from '../src/pipeline/icc.js';
import { sniff } from '../src/pipeline/sniff.js';
import { SsimPool } from '../src/pipeline/ssim-pool.js';

interface ManifestEntry {
  file: string;
  width: number;
  height: number;
}

const fixtures = fileURLToPath(new URL('../fixtures/', import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(fixtures, 'manifest.json'), 'utf8'),
) as ManifestEntry[];
const bench = (file: string) => join(fixtures, 'bench', file);
// As imagens reais ficam fora do git (`pnpm fixtures:fetch`; no CI, em cache).
const available = manifest.every((entry) => existsSync(bench(entry.file)));

describe.skipIf(!available)('imagens reais (fixtures/bench)', () => {
  let dir: string;
  let pool: SsimPool;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fixtures-'));
    pool = new SsimPool(2);
  });
  afterAll(async () => {
    await pool.close();
    await rm(dir, { recursive: true, force: true });
  });

  it.each(manifest)('$file: formato e dimensões pelo conteúdo', async ({ file, width, height }) => {
    const sniffed = await sniff(bench(file));
    expect(sniffed.format).toBe(
      { jpg: 'jpeg', png: 'png', tif: 'tiff' }[file.split('.').pop() ?? ''],
    );
    expect([sniffed.width, sniffed.height]).toEqual([width, height]);
  });

  it('gamut: Adobe RGB conta como largo; as fotos sRGB, não', async () => {
    const wide = async (file: string) => describeIcc((await sniff(bench(file))).icc).wideGamut;
    expect(await wide('chart.png')).toBe(true);
    expect(await wide('portrait.jpg')).toBe(false);
    expect(await wide('tiff16.tif')).toBe(false);
  });

  it('PNG com transparência e TIFF de 16 bits são reconhecidos', async () => {
    expect((await sniff(bench('alpha.png'))).hasAlpha).toBe(true);
    expect((await sharp(bench('tiff16.tif')).metadata()).depth).toBe('ushort');
  });

  // O HEIC é gerado pelo heif-enc (x265) a partir de heic-source.jpg; sem ele, não existe.
  it.skipIf(!existsSync(bench('phone.heic')))('HEIC de 13 MP: decodificado inteiro', async () => {
    const sniffed = await sniff(bench('phone.heic'));
    expect(sniffed).toMatchObject({ format: 'heic', width: 4524, height: 2940 });
    const tiff = await decodeHeic(
      heifDecoderFromEnv(process.env['HEIF_DEC_BIN']),
      bench('phone.heic'),
      dir,
    );
    expect(await sharp(tiff).metadata()).toMatchObject({
      format: 'tiff',
      width: 4524,
      height: 2940,
    });
  });

  it('foto real de 800px: todos os derivativos alcançam o SSIM alvo', async () => {
    const { derivatives, stats } = await generateDerivatives(
      { path: bench('small-800.jpg'), width: 800, height: 800, output: 'srgb', grey: false },
      { ssim: pool.forJob(2) },
    );
    expect(derivatives.map((d) => `${d.format} ${String(d.width)}`)).toEqual([
      'avif 320',
      'avif 640',
      'avif 800',
      'webp 320',
      'webp 640',
      'webp 800',
      'jpeg 800',
    ]);
    expect(stats.targetMissed).toBe(0);
    for (const d of derivatives) expect(d.ssim).toBeGreaterThanOrEqual(0.985);
  });
});
