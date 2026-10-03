import exifr from 'exifr';

import type { MediaExif } from '@casebook/contracts/media';

/** Campos do EXIF lidos; nada de GPS — nem lido, nem persistido. */
const PICK = [
  'Make',
  'Model',
  'LensModel',
  'ISO',
  'ISOSpeedRatings',
  'FNumber',
  'ExposureTime',
  'FocalLength',
  'DateTimeOriginal',
  'Orientation',
];

type Exif = Omit<MediaExif, 'color'>;

/** EXIF relevante (RF-MP-7). Arquivo sem EXIF, ou ilegível, devolve tudo `null`. */
export async function readExif(path: string): Promise<Exif> {
  let raw: Record<string, unknown> = {};
  try {
    raw =
      // O exifr é CommonJS: no Node só existe o export default.
      // eslint-disable-next-line import-x/no-named-as-default-member
      ((await exifr.parse(path, {
        pick: PICK,
        gps: false,
        xmp: false,
        icc: false,
        iptc: false,
        jfif: false,
        ihdr: false,
        interop: false,
        reviveValues: false,
        translateValues: false,
      })) as Record<string, unknown> | undefined) ?? {};
  } catch {
    // EXIF corrompido não impede o processamento: só ficamos sem os campos.
  }
  const iso = num(raw['ISO']) ?? num(first(raw['ISOSpeedRatings']));
  const orientation = num(raw['Orientation']);
  return {
    camera_make: str(raw['Make']),
    camera_model: str(raw['Model']),
    lens: str(raw['LensModel']),
    iso,
    aperture: round(num(raw['FNumber']), 2),
    exposure_time: num(raw['ExposureTime']),
    focal_length_mm: round(num(raw['FocalLength']), 1),
    taken_at: exifDate(raw['DateTimeOriginal']),
    orientation: orientation !== null && orientation >= 1 && orientation <= 8 ? orientation : null,
  };
}

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/\u0000/g, '').trim();
  return clean === '' ? null : clean.slice(0, 120);
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function first(value: unknown): unknown {
  return Array.isArray(value) ? (value as unknown[])[0] : value;
}

function round(value: number | null, digits: number): number | null {
  return value === null ? null : Number(value.toFixed(digits));
}

/** "2024:05:01 18:30:12" → "2024-05-01T18:30:12" (hora local da câmera, sem fuso). */
function exifDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value);
  return match ? `${match.slice(1, 4).join('-')}T${match.slice(4, 7).join(':')}` : null;
}
