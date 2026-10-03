import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { alphaPng, fakeDng, hugeHeaderPng, p3Png, syntheticJpeg } from '../../test/images.js';

import { PermanentImageError, USER_MESSAGES } from './errors.js';
import { sniff } from './sniff.js';

describe('sniff', () => {
  let dir: string;
  const file = async (name: string, data: Buffer) => {
    const path = join(dir, name);
    await writeFile(path, data);
    return path;
  };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sniff-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const rejects = async (path: string, message: string) => {
    const err = await sniff(path).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PermanentImageError);
    expect((err as PermanentImageError).userMessage).toBe(message);
  };

  it('reconhece pelo conteúdo, não pela extensão', async () => {
    const jpeg = await file('na-verdade-jpeg.png', await syntheticJpeg(64, 48));
    expect(await sniff(jpeg)).toMatchObject({ format: 'jpeg', width: 64, height: 48 });
    expect(await sniff(await file('alpha.bin', await alphaPng(64)))).toMatchObject({
      format: 'png',
      hasAlpha: true,
    });
    const p3 = await sniff(await file('p3.png', await p3Png(32, 32)));
    expect(p3.icc).toBeDefined();
  });

  it('HEIC: contêiner HEIF com HEVC', async () => {
    const heic = await readFile(new URL('../../fixtures/test/tiny.heic', import.meta.url));
    expect(await sniff(await file('foto.heic', heic))).toMatchObject({ format: 'heic' });
  });

  it('DNG (TIFF por dentro) → RAW, falha definitiva', async () => {
    await rejects(await file('foto.tif', fakeDng()), USER_MESSAGES.raw);
  });

  it('acima de 200 MP → falha definitiva, sem decodificar', async () => {
    await rejects(await file('bomba.png', hugeHeaderPng()), USER_MESSAGES.tooManyPixels);
  });

  it('bytes que não são imagem → formato não reconhecido', async () => {
    await rejects(
      await file('lixo.jpg', Buffer.from('isto não é uma imagem')),
      USER_MESSAGES.unsupportedFormat,
    );
  });
});
