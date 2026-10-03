/**
 * Leitura mínima de perfil ICC: descrição e se o gamut é maior que o sRGB.
 *
 * O gamut vem dos colorantes (`rXYZ`, `gXYZ`, `bXYZ`, em XYZ D50 no PCS): a
 * área do triângulo das primárias no diagrama xy é comparada com a do sRGB.
 * Display P3 dá ~1,36×, Adobe RGB ~1,35×, ProPhoto ~2,2×. Perfil sem colorantes
 * (cinza, CMYK, LUT) conta como estreito: a saída vai para sRGB.
 */

export interface IccInfo {
  /** Descrição do perfil (tag `desc`), ex.: "Display P3". */
  description: string | null;
  /** Espaço de cor do perfil (cabeçalho), ex.: "RGB", "GRAY", "CMYK". */
  colourSpace: string | null;
  wideGamut: boolean;
}

/** Margem acima da área do sRGB a partir da qual o perfil conta como largo. */
const WIDE_GAMUT_RATIO = 1.05;

// Primárias do sRGB adaptadas a D50, como no perfil sRGB IEC61966-2.1.
const SRGB_AREA = triangleArea([
  [0.4360747, 0.2225045, 0.0139322],
  [0.3850649, 0.7168786, 0.0971045],
  [0.1430804, 0.0606169, 0.7141733],
]);

export function describeIcc(icc: Buffer | undefined): IccInfo {
  if (!icc || icc.length < 132) return { description: null, colourSpace: null, wideGamut: false };
  const tags = readTagTable(icc);
  const colourSpace = icc.toString('latin1', 16, 20).trim() || null;
  const description = readDescription(icc, tags.get('desc'));
  const primaries = ['rXYZ', 'gXYZ', 'bXYZ'].map((sig) => readXyz(icc, tags.get(sig)));
  const wideGamut =
    colourSpace === 'RGB' &&
    primaries.every((p) => p !== undefined) &&
    triangleArea(primaries) > SRGB_AREA * WIDE_GAMUT_RATIO;
  return { description, colourSpace, wideGamut };
}

type Xyz = [number, number, number];
interface TagEntry {
  offset: number;
  size: number;
}

function readTagTable(icc: Buffer): Map<string, TagEntry> {
  const tags = new Map<string, TagEntry>();
  const count = icc.readUInt32BE(128);
  for (let i = 0; i < count; i++) {
    const at = 132 + i * 12;
    if (at + 12 > icc.length) break;
    const offset = icc.readUInt32BE(at + 4);
    const size = icc.readUInt32BE(at + 8);
    if (offset + size <= icc.length) {
      tags.set(icc.toString('latin1', at, at + 4), { offset, size });
    }
  }
  return tags;
}

function readDescription(icc: Buffer, tag: TagEntry | undefined): string | null {
  if (!tag || tag.size < 12) return null;
  const type = icc.toString('latin1', tag.offset, tag.offset + 4);
  if (type === 'desc') {
    // ICC v2: contagem ASCII (com o NUL) seguida do texto.
    const length = icc.readUInt32BE(tag.offset + 8);
    const start = tag.offset + 12;
    const text = icc.toString('latin1', start, Math.min(start + length, tag.offset + tag.size));
    return clean(text);
  }
  if (type === 'mluc') {
    // ICC v4: registros por idioma em UTF-16BE; usa o primeiro.
    const records = icc.readUInt32BE(tag.offset + 8);
    if (records === 0) return null;
    const length = icc.readUInt32BE(tag.offset + 20);
    const start = tag.offset + icc.readUInt32BE(tag.offset + 24);
    const utf16be = icc.subarray(start, Math.min(start + length, tag.offset + tag.size));
    return clean(Buffer.from(utf16be).swap16().toString('utf16le'));
  }
  return null;
}

function readXyz(icc: Buffer, tag: TagEntry | undefined): Xyz | undefined {
  if (!tag || tag.size < 20 || icc.toString('latin1', tag.offset, tag.offset + 4) !== 'XYZ ') {
    return undefined;
  }
  const s15 = (at: number) => icc.readInt32BE(at) / 65536;
  return [s15(tag.offset + 8), s15(tag.offset + 12), s15(tag.offset + 16)];
}

function triangleArea(primaries: Xyz[]): number {
  const xy = primaries.map(([x, y, z]) => {
    const sum = x + y + z || 1;
    return [x / sum, y / sum] as const;
  });
  const [a, b, c] = xy as [
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
  ];
  return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
}

function clean(text: string): string | null {
  // eslint-disable-next-line no-control-regex
  const trimmed = text.replace(/\u0000+$/, '').trim();
  return trimmed === '' ? null : trimmed;
}
