import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { paletteSchema } from '@casebook/contracts/media';

import { alphaPng, syntheticJpeg } from '../../test/images.js';

import { extractPalette } from './palette.js';

describe('extractPalette', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'palette-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('determinística: mesma imagem, mesma paleta', async () => {
    const path = join(dir, 'foto.jpg');
    await writeFile(path, await syntheticJpeg(640, 480));
    const first = await extractPalette(path);
    expect(await extractPalette(path)).toEqual(first);
    expect(paletteSchema.parse(first)).toEqual(first);
    expect(first.colors.length).toBeLessThanOrEqual(5);
    const ratios = first.colors.map((c) => c.ratio);
    expect(ratios).toEqual([...ratios].sort((a, b) => b - a));
    expect(ratios.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2);
    expect(first.dominant).toBe(first.colors[0]?.hex);
  });

  it('sugestões legíveis: bg com 4,5:1 contra o fg; acento com 3:1 contra o bg', async () => {
    const path = join(dir, 'foto2.jpg');
    await writeFile(path, await syntheticJpeg(320, 240));
    const { suggested } = await extractPalette(path);
    const { wcagContrast } = await import('culori');
    expect(wcagContrast(suggested.bg, suggested.fg)).toBeGreaterThanOrEqual(4.5);
    expect(wcagContrast(suggested.accent, suggested.bg)).toBeGreaterThanOrEqual(3);
  });

  it('ignora pixels transparentes', async () => {
    const path = join(dir, 'alpha.png');
    await writeFile(path, await alphaPng(200));
    const palette = await extractPalette(path);
    // Só o círculo (#c8402a) conta: nada de preto/branco do fundo transparente.
    expect(palette.colors.length).toBeLessThanOrEqual(5);
    expect(palette.dominant).toMatch(/^#[c-d][0-9a-f]4[0-9a-f]2[0-9a-f]$/);
  });
});
