import { converter, formatHex, type Oklab, wcagContrast } from 'culori';
import sharp from 'sharp';

import { type Palette, paletteSchema } from '@casebook/contracts/media';

import { MAX_INPUT_PIXELS } from './sniff.js';

/** Lado maior da miniatura usada na paleta. */
export const PALETTE_SIZE = 64;
export const PALETTE_COLORS = 5;
/** Pixels com alfa abaixo disto não entram (quase transparentes). */
const MIN_ALPHA = 26; // ~10%
const MAX_ITERATIONS = 30;
/** Semente fixa: mesma imagem, mesma paleta. */
const SEED = 0x5eed;

/** Contraste mínimo do fundo sugerido contra o texto (WCAG AA, texto normal). */
const BG_MIN_CONTRAST = 4.5;
/** Contraste mínimo do acento contra o fundo (WCAG, elementos de interface). */
const ACCENT_MIN_CONTRAST = 3;

const oklab = converter('oklab');
const toRgb = converter('rgb');
const toOklch = converter('oklch');

function toOklab(color: Parameters<typeof oklab>[0]): Oklab {
  const lab = oklab(color);
  if (!lab) throw new Error(`cor inválida: ${JSON.stringify(color)}`);
  return { mode: 'oklab', l: lab.l, a: lab.a, b: lab.b };
}

/**
 * Paleta da imagem (RF-MP-4), sempre em sRGB (hex para CSS): miniatura de 64px
 * → OKLab (perceptualmente uniforme, então a distância euclidiana significa algo)
 * → k-means com k = 5 e inicialização k-means++ com semente fixa.
 */
export async function extractPalette(path: string): Promise<Palette> {
  const { data, info } = await sharp(path, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
    .rotate()
    .resize(PALETTE_SIZE, PALETTE_SIZE, { fit: 'inside' })
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const points: Oklab[] = [];
  for (let i = 0; i < info.width * info.height; i++) {
    const p = i * 4;
    if ((data[p + 3] ?? 0) < MIN_ALPHA) continue;
    points.push(
      toOklab({
        mode: 'rgb',
        r: (data[p] ?? 0) / 255,
        g: (data[p + 1] ?? 0) / 255,
        b: (data[p + 2] ?? 0) / 255,
      }),
    );
  }
  if (points.length === 0) {
    // Imagem inteiramente transparente: paleta neutra, para não quebrar o tema.
    points.push(toOklab({ mode: 'rgb', r: 0.5, g: 0.5, b: 0.5 }));
  }
  return paletteFromPoints(points);
}

export function paletteFromPoints(points: Oklab[]): Palette {
  const clusters = kmeans(points, Math.min(PALETTE_COLORS, distinctCount(points)));
  const colors = clusters
    .map((cluster) => {
      const hex = hexOf(cluster.center);
      return {
        hex,
        ratio: round(cluster.size / points.length, 4),
        contrast_white: round(wcagContrast(hex, '#ffffff'), 2),
        contrast_black: round(wcagContrast(hex, '#000000'), 2),
      };
    })
    .sort((a, b) => b.ratio - a.ratio || a.hex.localeCompare(b.hex));

  const dominant = colors[0]?.hex ?? '#808080';
  const bg = darkEnough(dominant);
  const fg = wcagContrast(bg, '#ffffff') >= wcagContrast(bg, '#000000') ? '#ffffff' : '#000000';
  const accent = pickAccent(
    colors.map((c) => c.hex),
    bg,
  );

  return paletteSchema.parse({ dominant, colors, suggested: { bg, fg, accent } });
}

interface Cluster {
  center: Oklab;
  size: number;
}

function kmeans(points: Oklab[], k: number): Cluster[] {
  const random = mulberry32(SEED);
  // k-means++: o primeiro centro sorteado; os seguintes com probabilidade
  // proporcional ao quadrado da distância ao centro mais próximo.
  const first = points[0];
  if (!first) throw new Error('paleta sem pontos');
  const centers: Oklab[] = [points[Math.floor(random() * points.length)] ?? first];
  while (centers.length < k) {
    const weights = points.map((p) => Math.min(...centers.map((c) => dist2(p, c))));
    const sum = weights.reduce((a, b) => a + b, 0);
    let target = random() * sum;
    let index = 0;
    for (; index < weights.length - 1; index++) {
      target -= weights[index] ?? 0;
      if (target <= 0) break;
    }
    centers.push(points[index] ?? first);
  }

  const assignment = new Int32Array(points.length).fill(-1);
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    let changed = false;
    for (const [i, p] of points.entries()) {
      let best = 0;
      let bestDist = Infinity;
      for (const [j, c] of centers.entries()) {
        const d = dist2(p, c);
        if (d < bestDist) {
          bestDist = d;
          best = j;
        }
      }
      if (assignment[i] !== best) {
        assignment[i] = best;
        changed = true;
      }
    }
    if (!changed) break;
    centers.forEach((_, j) => {
      let l = 0;
      let a = 0;
      let b = 0;
      let n = 0;
      points.forEach((p, i) => {
        if (assignment[i] !== j) return;
        l += p.l;
        a += p.a;
        b += p.b;
        n++;
      });
      if (n > 0) centers[j] = { mode: 'oklab', l: l / n, a: a / n, b: b / n };
    });
  }

  const sizes = new Array<number>(centers.length).fill(0);
  for (const j of assignment) sizes[j] = (sizes[j] ?? 0) + 1;
  return centers.map((center, j) => ({ center, size: sizes[j] ?? 0 })).filter((c) => c.size > 0);
}

/** Fundo sugerido: a dominante, escurecida em L (OKLab) até dar 4,5:1 com texto claro. */
function darkEnough(hex: string): string {
  if (wcagContrast(hex, '#ffffff') >= BG_MIN_CONTRAST) return hex;
  const lab = toOklab(hex);
  let lo = 0;
  let hi = lab.l;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (wcagContrast(hexOf({ ...lab, l: mid }), '#ffffff') >= BG_MIN_CONTRAST) lo = mid;
    else hi = mid;
  }
  return hexOf({ ...lab, l: lo });
}

/**
 * Acento: a cor mais saturada (croma em OKLCH) com 3:1 contra o fundo. Se
 * nenhuma chega lá, clareia a mais saturada até chegar.
 */
function pickAccent(hexes: string[], bg: string): string {
  const byChroma = [...hexes].sort((a, b) => (toOklch(b)?.c ?? 0) - (toOklch(a)?.c ?? 0));
  const ok = byChroma.find((hex) => wcagContrast(hex, bg) >= ACCENT_MIN_CONTRAST);
  if (ok) return ok;
  const lab = toOklab(byChroma[0] ?? '#808080');
  for (let l = lab.l; l <= 1; l += 0.02) {
    const candidate = hexOf({ ...lab, l });
    if (wcagContrast(candidate, bg) >= ACCENT_MIN_CONTRAST) return candidate;
  }
  return '#ffffff';
}

function hexOf(color: Oklab): string {
  // Fora do gamut sRGB (possível depois de mexer em L): recorta por canal.
  const rgb = toRgb(color);
  const clamp = (v: number | undefined) => Math.min(1, Math.max(0, v ?? 0));
  return formatHex({ mode: 'rgb', r: clamp(rgb.r), g: clamp(rgb.g), b: clamp(rgb.b) });
}

function dist2(p: Oklab, q: Oklab): number {
  return (p.l - q.l) ** 2 + (p.a - q.a) ** 2 + (p.b - q.b) ** 2;
}

function distinctCount(points: Oklab[]): number {
  return new Set(points.map((p) => hexOf(p))).size;
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

/** PRNG pequeno e determinístico (mulberry32). */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
