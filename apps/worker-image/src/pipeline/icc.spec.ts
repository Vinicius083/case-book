import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { describeIcc } from './icc.js';

async function profile(name: 'srgb' | 'p3'): Promise<Buffer | undefined> {
  const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#888' } })
    .withIccProfile(name)
    .png()
    .toBuffer();
  return (await sharp(png).metadata()).icc;
}

describe('describeIcc', () => {
  it('sRGB é estreito; Display P3 é largo', async () => {
    expect(describeIcc(await profile('srgb'))).toMatchObject({
      colourSpace: 'RGB',
      wideGamut: false,
    });
    expect(describeIcc(await profile('p3'))).toMatchObject({ colourSpace: 'RGB', wideGamut: true });
  });

  it('sem perfil ou perfil truncado: estreito, sem descrição', () => {
    expect(describeIcc(undefined)).toEqual({
      description: null,
      colourSpace: null,
      wideGamut: false,
    });
    expect(describeIcc(Buffer.alloc(40))).toMatchObject({ wideGamut: false });
  });
});
