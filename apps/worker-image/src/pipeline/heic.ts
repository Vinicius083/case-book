import { execFile } from 'node:child_process';
import { open, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import sharp from 'sharp';

import { PermanentImageError, USER_MESSAGES } from './errors.js';

const run = promisify(execFile);

export interface HeifDecoder {
  /** `heif-dec` do libheif ≥ 1.18 (o primeiro a escrever TIFF). */
  bin: string;
}

export function heifDecoderFromEnv(bin: string | undefined): HeifDecoder {
  return { bin: bin ?? 'heif-dec' };
}

/**
 * O sharp pré-compilado não decodifica HEVC (o libvips dele vem sem libde265).
 * HEIC vira um TIFF sem perda (16 bits quando a fonte tem mais de 8) pelo
 * `heif-dec`, e segue o pipeline normal. O libheif já aplica a rotação do
 * contêiner (`irot`/`imir`), então o TIFF sai na orientação certa e sem EXIF.
 *
 * Por que TIFF e com o ICC reinjetado: o PNG do libheif passa pela libpng, que
 * recusa perfis comuns em fotos reais ("known incorrect sRGB profile", o sRGB
 * da HP) e o processo sai com código 0 e arquivo vazio; o TIFF do libheif 1.19
 * grava os pixels mas descarta o ICC. Sem o perfil, um HEIC de iPhone (Display
 * P3) seria tratado como sRGB e perderia saturação. Então o perfil é lido do
 * próprio HEIC (`colr`) e gravado no TIFF.
 */
export async function decodeHeic(
  decoder: HeifDecoder,
  input: string,
  workDir: string,
): Promise<string> {
  const output = join(workDir, 'heic-decoded.tiff');
  try {
    await run(decoder.bin, ['--quiet', input, output], { timeout: 120_000 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      // Binário ausente é erro de deploy, não do arquivo: transitório.
      throw new Error(`decodificador HEIC não encontrado: ${decoder.bin}`, { cause: err });
    }
    throw new PermanentImageError(USER_MESSAGES.unreadable, `heif-dec falhou: ${String(err)}`);
  }
  // O libheif sai com 0 mesmo quando o encoder de saída falha.
  const written = await stat(output).catch(() => undefined);
  if (!written || written.size === 0) {
    throw new PermanentImageError(
      USER_MESSAGES.unreadable,
      'heif-dec não gerou o arquivo de saída',
    );
  }
  const icc = await heicColourProfile(await readFile(input));
  if (icc) await injectTiffIcc(output, icc);
  return output;
}

/**
 * Perfil de cor do HEIC: o ICC da caixa `colr` (`prof` ou `rICC`), ou, para
 * `nclx` com primárias Display P3 (código 12), o perfil P3. `undefined` = sRGB.
 */
export async function heicColourProfile(heic: Buffer): Promise<Buffer | undefined> {
  const limit = Math.min(heic.length, 1024 * 1024);
  let nclxPrimaries: number | undefined;
  for (
    let at = heic.indexOf('colr', 0, 'latin1');
    at !== -1 && at < limit;
    at = heic.indexOf('colr', at + 4, 'latin1')
  ) {
    if (at < 4) continue;
    const size = heic.readUInt32BE(at - 4);
    const type = heic.toString('latin1', at + 4, at + 8);
    if ((type === 'prof' || type === 'rICC') && size > 12 && at - 4 + size <= heic.length) {
      return heic.subarray(at + 8, at - 4 + size);
    }
    if (type === 'nclx' && nclxPrimaries === undefined) nclxPrimaries = heic.readUInt16BE(at + 8);
  }
  return nclxPrimaries === 12 ? displayP3Profile() : undefined;
}

let p3: Promise<Buffer> | undefined;

/** O perfil Display P3 que acompanha o sharp. */
function displayP3Profile(): Promise<Buffer> {
  p3 ??= sharp({ create: { width: 1, height: 1, channels: 3, background: '#808080' } })
    .withIccProfile('p3')
    .png()
    .toBuffer()
    .then(async (png) => {
      const { icc } = await sharp(png).metadata();
      if (!icc) throw new Error('sharp sem o perfil P3 embutido');
      return icc;
    });
  return p3;
}

const TAG_ICC_PROFILE = 34675;
const TYPE_UNDEFINED = 7;

/**
 * Grava o ICC num TIFF clássico (tag 34675): o perfil vai para o fim do arquivo
 * e uma cópia da IFD0 com a entrada nova também; o cabeçalho passa a apontar
 * para ela. Os dados referenciados pelas outras entradas não se movem.
 */
export async function injectTiffIcc(path: string, icc: Buffer): Promise<void> {
  const file = await open(path, 'r+');
  try {
    const { size } = await file.stat();
    const header = Buffer.alloc(8);
    await file.read(header, 0, 8, 0);
    const order = header.toString('latin1', 0, 2);
    if ((order !== 'II' && order !== 'MM') || header.readUInt16LE(2) === 43) {
      throw new Error('não é um TIFF clássico');
    }
    const le = order === 'II';
    const u16 = (b: Buffer, at: number) => (le ? b.readUInt16LE(at) : b.readUInt16BE(at));
    const u32 = (b: Buffer, at: number) => (le ? b.readUInt32LE(at) : b.readUInt32BE(at));
    const w16 = (b: Buffer, v: number, at: number) =>
      le ? b.writeUInt16LE(v, at) : b.writeUInt16BE(v, at);
    const w32 = (b: Buffer, v: number, at: number) =>
      le ? b.writeUInt32LE(v, at) : b.writeUInt32BE(v, at);

    const ifdOffset = u32(header, 4);
    const countBuf = Buffer.alloc(2);
    await file.read(countBuf, 0, 2, ifdOffset);
    const count = u16(countBuf, 0);
    const old = Buffer.alloc(count * 12 + 4);
    await file.read(old, 0, old.length, ifdOffset + 2);

    const entries: Buffer[] = [];
    for (let i = 0; i < count; i++) {
      const entry = old.subarray(i * 12, i * 12 + 12);
      if (u16(entry, 0) !== TAG_ICC_PROFILE) entries.push(Buffer.from(entry));
    }
    const iccOffset = size + (size % 2); // dados em offset par
    const iccEntry = Buffer.alloc(12);
    w16(iccEntry, TAG_ICC_PROFILE, 0);
    w16(iccEntry, TYPE_UNDEFINED, 2);
    w32(iccEntry, icc.length, 4);
    w32(iccEntry, iccOffset, 8);
    entries.push(iccEntry);
    entries.sort((a, b) => u16(a, 0) - u16(b, 0));

    const newIfdOffset = iccOffset + icc.length + (icc.length % 2);
    const ifd = Buffer.alloc(2 + entries.length * 12 + 4);
    w16(ifd, entries.length, 0);
    entries.forEach((entry, i) => entry.copy(ifd, 2 + i * 12));
    w32(ifd, u32(old, count * 12), 2 + entries.length * 12); // próxima IFD, como era

    await file.write(Buffer.alloc(iccOffset - size), 0, iccOffset - size, size);
    await file.write(icc, 0, icc.length, iccOffset);
    if (icc.length % 2) await file.write(Buffer.alloc(1), 0, 1, iccOffset + icc.length);
    await file.write(ifd, 0, ifd.length, newIfdOffset);
    const pointer = Buffer.alloc(4);
    w32(pointer, newIfdOffset, 0);
    await file.write(pointer, 0, 4, 4);
  } finally {
    await file.close();
  }
}
