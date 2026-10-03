import { deflateSync } from 'node:zlib';

import sharp from 'sharp';

// Imagens de teste geradas na hora, pequenas e determinísticas: nada de binário
// versionado além do HEIC (que exige um encoder HEVC para gerar).

/** Perfil Display P3 embutido no próprio sharp. */
export async function p3Profile(): Promise<Buffer> {
  const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#808080' } })
    .withIccProfile('p3')
    .png()
    .toBuffer();
  const { icc } = await sharp(png).metadata();
  if (!icc) throw new Error('sharp sem perfil P3');
  return icc;
}

/**
 * PNG marcado como Display P3 com cores fora do sRGB: faixas de verde, vermelho
 * e azul puros no espaço P3, mais um degradê. Os valores são gravados como
 * estão (sem conversão) e o `iCCP` é injetado à mão.
 */
export async function p3Png(width = 480, height = 320): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const band = Math.floor((y / height) * 4);
      if (band === 0)
        raw[i + 1] = 255; // verde P3 puro
      else if (band === 1)
        raw[i] = 255; // vermelho P3 puro
      else if (band === 2)
        raw[i + 2] = 255; // azul P3 puro
      else {
        raw[i] = Math.round((x / width) * 255);
        raw[i + 1] = Math.round((y / height) * 255);
        raw[i + 2] = 128;
      }
    }
  }
  const png = await sharp(raw, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
  return injectIccIntoPng(png, await p3Profile(), 'Display P3');
}

/** Foto sintética (degradê + textura) num tamanho dado, em JPEG sRGB. */
export async function syntheticJpeg(width: number, height: number): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  let seed = 7;
  const noise = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed % 21) - 10;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const t = 40 * Math.sin(x / 9) * Math.cos(y / 11);
      raw[i] = clamp((x / width) * 200 + t + noise());
      raw[i + 1] = clamp((y / height) * 180 + t + noise());
      raw[i + 2] = clamp(120 + t + noise());
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 92 })
    .toBuffer();
}

/** PNG com alfa: círculo opaco sobre fundo transparente. */
export async function alphaPng(size = 400): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${String(size)}" height="${String(size)}"><circle cx="${String(size / 2)}" cy="${String(size / 2)}" r="${String(size / 3)}" fill="#c8402a"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * TIFF mínimo com a tag DNGVersion: o libvips o carrega como TIFF comum, e só
 * a checagem de estrutura do worker o reconhece como RAW.
 */
export function fakeDng(): Buffer {
  const width = 8;
  const height = 8;
  const pixels = Buffer.alloc(width * height, 128);
  const entries: [tag: number, type: number, count: number, value: number][] = [
    [256, 3, 1, width], // ImageWidth
    [257, 3, 1, height], // ImageLength
    [258, 3, 1, 8], // BitsPerSample
    [259, 3, 1, 1], // Compression: nenhuma
    [262, 3, 1, 1], // Photometric: BlackIsZero
    [273, 4, 1, 0], // StripOffsets (preenchido abaixo)
    [277, 3, 1, 1], // SamplesPerPixel
    [278, 3, 1, height], // RowsPerStrip
    [279, 4, 1, pixels.length], // StripByteCounts
    [50706, 1, 4, 0x00000401], // DNGVersion 1.4.0.0 (4 bytes, inline)
  ];
  const ifdOffset = 8;
  const ifdSize = 2 + entries.length * 12 + 4;
  const dataOffset = ifdOffset + ifdSize;
  const buf = Buffer.alloc(dataOffset + pixels.length);
  buf.write('II', 0, 'latin1');
  buf.writeUInt16LE(42, 2);
  buf.writeUInt32LE(ifdOffset, 4);
  buf.writeUInt16LE(entries.length, ifdOffset);
  entries.forEach(([tag, type, count, value], i) => {
    const at = ifdOffset + 2 + i * 12;
    buf.writeUInt16LE(tag, at);
    buf.writeUInt16LE(type, at + 2);
    buf.writeUInt32LE(count, at + 4);
    if (tag === 273) buf.writeUInt32LE(dataOffset, at + 8);
    else if (type === 3) buf.writeUInt16LE(value, at + 8);
    else buf.writeUInt32LE(value, at + 8);
  });
  buf.writeUInt32LE(0, ifdOffset + 2 + entries.length * 12); // sem próxima IFD
  pixels.copy(buf, dataOffset);
  return buf;
}

/**
 * PNG cujo cabeçalho declara 20000×20000 (400 MP) com um IDAT mínimo: o
 * `metadata()` lê as dimensões sem decodificar — o caso da bomba de pixels.
 */
export function hugeHeaderPng(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(20_000, 0);
  ihdr.writeUInt32BE(20_000, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.alloc(16))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function injectIccIntoPng(png: Buffer, icc: Buffer, name: string): Buffer {
  const ihdrEnd = 8 + 8 + 13 + 4;
  const body = Buffer.concat([Buffer.from(`${name}\0\0`, 'latin1'), deflateSync(icc)]);
  return Buffer.concat([png.subarray(0, ihdrEnd), chunk('iCCP', body), png.subarray(ihdrEnd)]);
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}
