import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { p3Profile } from '../../test/images.js';

import { heicColourProfile, injectTiffIcc } from './heic.js';
import { describeIcc } from './icc.js';

const fixture = (name: string) => readFile(new URL(`../../fixtures/test/${name}`, import.meta.url));

describe('perfil de cor do HEIC', () => {
  it('HEIC Display P3: o perfil da caixa colr é de gamut largo', async () => {
    const icc = await heicColourProfile(await fixture('tiny-p3.heic'));
    expect(describeIcc(icc).wideGamut).toBe(true);
  });

  it('HEIC sRGB: sem perfil, ou perfil estreito', async () => {
    const icc = await heicColourProfile(await fixture('tiny.heic'));
    expect(describeIcc(icc).wideGamut).toBe(false);
  });
});

describe('injectTiffIcc', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tiff-icc-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('grava o perfil no TIFF sem tocar nos pixels', async () => {
    const path = join(dir, 'sem-perfil.tiff');
    const raw = Buffer.from(Array.from({ length: 16 * 16 * 3 }, (_, i) => (i * 37) % 256));
    await sharp(raw, { raw: { width: 16, height: 16, channels: 3 } })
      .tiff({ compression: 'none' })
      .toFile(path);
    expect((await sharp(path).metadata()).icc).toBeUndefined();

    await injectTiffIcc(path, await p3Profile());

    const meta = await sharp(path).metadata();
    expect(describeIcc(meta.icc)).toMatchObject({ wideGamut: true });
    const pixels = await sharp(path, { ignoreIcc: true }).raw().toBuffer();
    expect(pixels.equals(raw)).toBe(true);
  });
});
