import { open } from 'node:fs/promises';

import sharp, { type Metadata } from 'sharp';

import { PermanentImageError, USER_MESSAGES } from './errors.js';

/** Teto de pixels da imagem de entrada (RF-MP, proteção contra bomba de descompressão). */
export const MAX_INPUT_PIXELS = 200_000_000;

export type SourceFormat = 'jpeg' | 'png' | 'webp' | 'tiff' | 'avif' | 'heic';

export interface SniffResult {
  format: SourceFormat;
  width: number;
  height: number;
  /** EXIF orientation (1–8), quando houver. */
  orientation: number | undefined;
  icc: Buffer | undefined;
  hasAlpha: boolean;
  channels: number;
}

/**
 * Formato pelo conteúdo (`sharp().metadata()` lê só o cabeçalho), nunca pelo
 * MIME declarado. RAW baseado em TIFF (DNG, NEF, ARW, CR2…) é carregado pelo
 * libvips como TIFF e passaria; por isso a checagem da estrutura TIFF abaixo.
 */
export async function sniff(path: string): Promise<SniffResult> {
  // O libvips do sharp pré-compilado nem lê o cabeçalho de HEIC: identifica pela
  // caixa `ftyp` e tira as dimensões da `ispe`, para o teto de pixels valer antes
  // de decodificar.
  const heic = await sniffHeic(path);
  if (heic) {
    if (heic.width * heic.height > MAX_INPUT_PIXELS) throw tooManyPixels(heic.width, heic.height);
    return {
      format: 'heic',
      ...heic,
      orientation: undefined,
      icc: undefined,
      hasAlpha: false,
      channels: 3,
    };
  }

  let meta: Metadata;
  try {
    meta = await sharp(path, { limitInputPixels: false }).metadata();
  } catch (err) {
    throw new PermanentImageError(USER_MESSAGES.unsupportedFormat, `sniff: ${String(err)}`);
  }

  const format = classify(meta);
  if (!format) {
    throw new PermanentImageError(
      USER_MESSAGES.unsupportedFormat,
      `formato não aceito: ${meta.format}/${meta.compression ?? '-'}`,
    );
  }
  if (format === 'tiff' && (await isTiffRaw(path))) {
    throw new PermanentImageError(USER_MESSAGES.raw, 'RAW em contêiner TIFF (DNG, NEF, ARW, CR2…)');
  }

  const { width, height } = meta;
  if (width * height > MAX_INPUT_PIXELS) throw tooManyPixels(width, height);
  return {
    format,
    width,
    height,
    orientation: meta.orientation,
    icc: meta.icc,
    hasAlpha: meta.hasAlpha,
    channels: meta.channels,
  };
}

function tooManyPixels(width: number, height: number): PermanentImageError {
  return new PermanentImageError(
    USER_MESSAGES.tooManyPixels,
    `${String(width)}×${String(height)} passa de ${String(MAX_INPUT_PIXELS)} pixels`,
  );
}

/** Marcas HEVC do HEIF (ISO/IEC 23008-12). AVIF (`avif`, `avis`) segue pelo sharp. */
const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs']);

/**
 * HEIC pelo `ftyp` (marca principal ou compatível) e dimensões pela maior caixa
 * `ispe` dos primeiros 256 KB (a imagem primária de uma grade é a maior).
 */
async function sniffHeic(path: string): Promise<{ width: number; height: number } | undefined> {
  const file = await open(path, 'r');
  try {
    const head = Buffer.alloc(256 * 1024);
    const { bytesRead } = await file.read(head, 0, head.length, 0);
    const buf = head.subarray(0, bytesRead);
    if (buf.length < 16 || buf.toString('latin1', 4, 8) !== 'ftyp') return undefined;
    const ftypSize = buf.readUInt32BE(0);
    const brands = [buf.toString('latin1', 8, 12)];
    for (let at = 16; at + 4 <= Math.min(ftypSize, buf.length); at += 4) {
      brands.push(buf.toString('latin1', at, at + 4));
    }
    if (!brands.some((brand) => HEIC_BRANDS.has(brand))) return undefined;

    let width = 0;
    let height = 0;
    for (
      let at = buf.indexOf('ispe', 0, 'latin1');
      at !== -1;
      at = buf.indexOf('ispe', at + 4, 'latin1')
    ) {
      // 'ispe' + versão/flags (4) + largura (4) + altura (4)
      if (at + 16 > buf.length) break;
      const w = buf.readUInt32BE(at + 8);
      const h = buf.readUInt32BE(at + 12);
      if (w * h > width * height) {
        width = w;
        height = h;
      }
    }
    if (width === 0 || height === 0) {
      throw new PermanentImageError(USER_MESSAGES.unreadable, 'HEIC sem caixa ispe');
    }
    return { width, height };
  } finally {
    await file.close();
  }
}

function classify(meta: Metadata): SourceFormat | undefined {
  switch (meta.format) {
    case 'jpeg':
    case 'png':
    case 'webp':
    case 'tiff':
      return meta.format;
    case 'heif':
      // O mesmo contêiner leva AV1 (AVIF, decodificado pelo sharp) ou HEVC
      // (HEIC, convertido com o heif-dec antes).
      if (meta.compression === 'av1') return 'avif';
      if (meta.compression === 'hevc') return 'heic';
      return undefined;
    default:
      return undefined;
  }
}

// Tags TIFF que denunciam RAW: versão DNG, ou uma IFD com dados de sensor
// (PhotometricInterpretation = CFA ou LinearRaw).
const TAG_SUBIFDS = 330;
const TAG_PHOTOMETRIC = 262;
const TAG_DNG_VERSION = 50706;
const PHOTOMETRIC_CFA = 32803;
const PHOTOMETRIC_LINEAR_RAW = 34892;

/**
 * Percorre a IFD0, as seguintes e as SubIFDs procurando sinais de RAW. Lê só o
 * necessário do arquivo; no máximo 32 IFDs, contra arquivo malformado em laço.
 */
export async function isTiffRaw(path: string): Promise<boolean> {
  const file = await open(path, 'r');
  try {
    const read = async (offset: number, length: number): Promise<Buffer> => {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await file.read(buffer, 0, length, offset);
      return buffer.subarray(0, bytesRead);
    };
    const header = await read(0, 8);
    if (header.length < 8) return false;
    const little = header.toString('latin1', 0, 2) === 'II';
    // Canon CR2: TIFF com "CR" no byte 8.
    if ((await read(8, 2)).toString('latin1') === 'CR') return true;
    const u16 = (b: Buffer, at: number) => (little ? b.readUInt16LE(at) : b.readUInt16BE(at));
    const u32 = (b: Buffer, at: number) => (little ? b.readUInt32LE(at) : b.readUInt32BE(at));

    const queue = [u32(header, 4)];
    const seen = new Set<number>();
    while (queue.length > 0 && seen.size < 32) {
      const offset = queue.shift() ?? 0;
      if (offset === 0 || seen.has(offset)) continue;
      seen.add(offset);
      const countBuf = await read(offset, 2);
      if (countBuf.length < 2) continue;
      const count = u16(countBuf, 0);
      const entries = await read(offset + 2, count * 12 + 4);
      for (let i = 0; i < count && (i + 1) * 12 <= entries.length; i++) {
        const at = i * 12;
        const tag = u16(entries, at);
        const type = u16(entries, at + 2);
        const n = u32(entries, at + 4);
        if (tag === TAG_DNG_VERSION) return true;
        if (tag === TAG_PHOTOMETRIC) {
          const value = type === 3 ? u16(entries, at + 8) : u32(entries, at + 8);
          if (value === PHOTOMETRIC_CFA || value === PHOTOMETRIC_LINEAR_RAW) return true;
        }
        if (tag === TAG_SUBIFDS) {
          if (n === 1) queue.push(u32(entries, at + 8));
          else {
            const list = await read(u32(entries, at + 8), n * 4);
            for (let j = 0; j + 4 <= list.length; j += 4) queue.push(u32(list, j));
          }
        }
      }
      if (entries.length >= count * 12 + 4) queue.push(u32(entries, count * 12));
    }
    return false;
  } finally {
    await file.close();
  }
}
