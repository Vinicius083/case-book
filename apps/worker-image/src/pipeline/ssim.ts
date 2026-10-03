/**
 * SSIM (Wang, Bovik, Sheikh e Simoncelli, 2004), na variante clássica:
 *
 * - **Canal:** luma Y′ = 0,2126 R′ + 0,7152 G′ + 0,0722 B′ (coeficientes BT.709)
 *   sobre os valores de 8 bits já codificados (com gama), no espaço de cor da
 *   saída — sRGB ou Display P3, conforme o derivativo. Imagem com alfa é
 *   composta sobre cinza médio antes (ver `lumaFromRaw`).
 * - **Janela:** gaussiana circular de 11×11, σ = 1,5, normalizada para soma 1.
 *   A gaussiana 2D é o produto de duas 1D, então a convolução é separável:
 *   uma passada horizontal e uma vertical de 11 coeficientes cada (22 produtos
 *   por pixel em vez de 121).
 * - **Constantes:** K1 = 0,01, K2 = 0,03, L = 255 → C1 = (K1·L)², C2 = (K2·L)².
 * - **Bordas:** só a região "válida" (janela inteira dentro da imagem); nada de
 *   preenchimento.
 * - **Escala:** na resolução do próprio derivativo. A implementação de
 *   referência em MATLAB reduz a imagem por round(min(M, N) / 256) antes de
 *   medir; aqui não, porque o que importa é o defeito na largura servida.
 * - **Resultado:** média do mapa SSIM, sobre a imagem inteira (sem amostragem).
 *
 * Com essas escolhas, 0,985 é um limiar exigente: a mesma imagem medida com a
 * redução do MATLAB ou em blocos 8×8 sem sobreposição daria números maiores.
 *
 * **Cache da referência.** Numa largura, o original redimensionado é comparado
 * com vários encodes (os passos da busca, as subidas de qualidade). Tudo que só
 * depende dele — a luma, a média local μx e a variância local σx² — é calculado
 * uma vez (`prepareReference`) e reaproveitado; cada medição (`ssimAgainst`)
 * filtra só o que depende do encode: μy, E[y²] e E[xy] (3 filtros em vez de 5).
 *
 * **Memória.** Os dados do tamanho da imagem são `Float32Array` (luma, μx, σx²),
 * em `SharedArrayBuffer` para as threads de medição lerem sem cópia. A passada
 * horizontal fica num anel de 11 linhas, então uma medição não aloca nada além
 * disso do tamanho da imagem.
 *
 * Este arquivo não tem imports relativos: a thread de medição (`ssim.worker`) o
 * carrega direto, do `dist` em produção e do fonte nos testes.
 */

import sharp from 'sharp';

const WINDOW = 11;
const SIGMA = 1.5;
const C1 = (0.01 * 255) ** 2;
const C2 = (0.03 * 255) ** 2;

/** Fundo da composição de imagens com alfa: cinza médio (#808080). */
export const ALPHA_BACKGROUND = 128;

const KERNEL: Float64Array = (() => {
  const k = new Float64Array(WINDOW);
  const half = (WINDOW - 1) / 2;
  let sum = 0;
  for (let i = 0; i < WINDOW; i++) {
    k[i] = Math.exp(-((i - half) ** 2) / (2 * SIGMA * SIGMA));
    sum += k[i] ?? 0;
  }
  for (let i = 0; i < WINDOW; i++) k[i] = (k[i] ?? 0) / sum;
  return k;
})();

const EMPTY = new Float32Array(0);

export interface LumaImage {
  width: number;
  height: number;
  /** Luma 0–255, linha a linha. */
  data: Float32Array;
}

/** A parte do SSIM que só depende da imagem de referência. */
export interface SsimReference {
  width: number;
  height: number;
  /** Luma da referência. */
  luma: Float32Array;
  /** μx na região válida: (width − 10) × (height − 10). Vazio se menor que a janela. */
  mean: Float32Array;
  /** σx² na região válida. */
  variance: Float32Array;
}

function sharedFloat32(length: number): Float32Array {
  return new Float32Array(new SharedArrayBuffer(length * Float32Array.BYTES_PER_ELEMENT));
}

/**
 * Luma a partir de pixels crus de 8 bits (1–4 canais). Com alfa, compõe sobre
 * cinza médio: cor sob pixel transparente é invisível, e o encoder tem liberdade
 * para mexer nela — sem a composição, o SSIM puniria uma diferença que ninguém
 * vê. Cinza, e não branco ou preto, porque o derivativo com alfa vai parar em
 * fundo claro ou escuro conforme o tema: o meio-termo não esconde erro de borda
 * em nenhum dos dois. Original e derivativo usam o mesmo fundo.
 */
export function lumaFromRaw(
  data: Uint8Array,
  width: number,
  height: number,
  channels: number,
): LumaImage {
  const out = sharedFloat32(width * height);
  const hasAlpha = channels === 2 || channels === 4;
  for (let i = 0, p = 0; i < out.length; i++, p += channels) {
    let y: number;
    if (channels >= 3) {
      y = 0.2126 * (data[p] ?? 0) + 0.7152 * (data[p + 1] ?? 0) + 0.0722 * (data[p + 2] ?? 0);
    } else {
      y = data[p] ?? 0;
    }
    if (hasAlpha) {
      const a = (data[p + channels - 1] ?? 0) / 255;
      y = y * a + ALPHA_BACKGROUND * (1 - a);
    }
    out[i] = y;
  }
  return { width, height, data: out };
}

/**
 * O canal alfa como imagem (0–255); `undefined` se não há canal alfa. Medido à
 * parte no AVIF, que codifica o alfa com perda.
 */
export function alphaFromRaw(
  data: Uint8Array,
  width: number,
  height: number,
  channels: number,
): { image: LumaImage; opaque: boolean } | undefined {
  if (channels !== 2 && channels !== 4) return undefined;
  const out = sharedFloat32(width * height);
  let opaque = true;
  for (let i = 0, p = channels - 1; i < out.length; i++, p += channels) {
    const a = data[p] ?? 0;
    if (a !== 255) opaque = false;
    out[i] = a;
  }
  return { image: { width, height, data: out }, opaque };
}

/** Passada horizontal de uma linha: `out[col] = Σ k[i] · row[offset + col + i]`. */
function filterRow(row: Float32Array, offset: number, out: Float32Array, outW: number): void {
  const k0 = KERNEL[0] ?? 0;
  const k1 = KERNEL[1] ?? 0;
  const k2 = KERNEL[2] ?? 0;
  const k3 = KERNEL[3] ?? 0;
  const k4 = KERNEL[4] ?? 0;
  const k5 = KERNEL[5] ?? 0;
  // O núcleo é simétrico: k[i] = k[10 − i].
  for (let col = 0, p = offset; col < outW; col++, p++) {
    out[col] =
      k0 * ((row[p] ?? 0) + (row[p + 10] ?? 0)) +
      k1 * ((row[p + 1] ?? 0) + (row[p + 9] ?? 0)) +
      k2 * ((row[p + 2] ?? 0) + (row[p + 8] ?? 0)) +
      k3 * ((row[p + 3] ?? 0) + (row[p + 7] ?? 0)) +
      k4 * ((row[p + 4] ?? 0) + (row[p + 6] ?? 0)) +
      k5 * (row[p + 5] ?? 0);
  }
}

/** Passada vertical: combina as 11 linhas do anel que terminam em `last`. */
function filterColumn(ring: Float32Array[], last: number, out: Float64Array, outW: number): void {
  const at = (k: number): Float32Array => ring[(last + 1 + k) % WINDOW] ?? EMPTY;
  const r0 = at(0);
  const r1 = at(1);
  const r2 = at(2);
  const r3 = at(3);
  const r4 = at(4);
  const r5 = at(5);
  const r6 = at(6);
  const r7 = at(7);
  const r8 = at(8);
  const r9 = at(9);
  const r10 = at(10);
  const k0 = KERNEL[0] ?? 0;
  const k1 = KERNEL[1] ?? 0;
  const k2 = KERNEL[2] ?? 0;
  const k3 = KERNEL[3] ?? 0;
  const k4 = KERNEL[4] ?? 0;
  const k5 = KERNEL[5] ?? 0;
  for (let col = 0; col < outW; col++) {
    out[col] =
      k0 * ((r0[col] ?? 0) + (r10[col] ?? 0)) +
      k1 * ((r1[col] ?? 0) + (r9[col] ?? 0)) +
      k2 * ((r2[col] ?? 0) + (r8[col] ?? 0)) +
      k3 * ((r3[col] ?? 0) + (r7[col] ?? 0)) +
      k4 * ((r4[col] ?? 0) + (r6[col] ?? 0)) +
      k5 * (r5[col] ?? 0);
  }
}

function newRing(outW: number): Float32Array[] {
  return Array.from({ length: WINDOW }, () => new Float32Array(outW));
}

/** Calcula uma vez o que só depende da referência: luma, μx e σx². */
export function prepareReference(reference: LumaImage): SsimReference {
  const { width, height, data: x } = reference;
  if (width < WINDOW || height < WINDOW) {
    return { width, height, luma: x, mean: new Float32Array(0), variance: new Float32Array(0) };
  }
  const outW = width - WINDOW + 1;
  const outH = height - WINDOW + 1;
  const mean = sharedFloat32(outW * outH);
  const variance = sharedFloat32(outW * outH);

  const ringX = newRing(outW);
  const ringXX = newRing(outW);
  const squares = new Float32Array(width);
  const accX = new Float64Array(outW);
  const accXX = new Float64Array(outW);

  for (let row = 0; row < height; row++) {
    const base = row * width;
    for (let i = 0; i < width; i++) {
      const v = x[base + i] ?? 0;
      squares[i] = v * v;
    }
    const slot = row % WINDOW;
    filterRow(x, base, ringX[slot] ?? EMPTY, outW);
    filterRow(squares, 0, ringXX[slot] ?? EMPTY, outW);
    if (row < WINDOW - 1) continue;

    filterColumn(ringX, row, accX, outW);
    filterColumn(ringXX, row, accXX, outW);
    const obase = (row - WINDOW + 1) * outW;
    for (let col = 0; col < outW; col++) {
      const m = accX[col] ?? 0;
      mean[obase + col] = m;
      variance[obase + col] = (accXX[col] ?? 0) - m * m;
    }
  }
  return { width, height, luma: x, mean, variance };
}

/** SSIM médio de `candidate` contra a referência preparada. 1 = idênticas. */
export function ssimAgainst(reference: SsimReference, candidate: LumaImage): number {
  const { width, height, luma: x, mean, variance } = reference;
  if (candidate.width !== width || candidate.height !== height) {
    throw new Error(
      `SSIM de tamanhos diferentes: ${String(width)}×${String(height)} × ${String(candidate.width)}×${String(candidate.height)}`,
    );
  }
  const y = candidate.data;
  if (width < WINDOW || height < WINDOW) {
    // Menor que a janela: cai para o SSIM global (uma janela do tamanho da imagem).
    return globalSsim(x, y);
  }
  const outW = width - WINDOW + 1;
  const outH = height - WINDOW + 1;

  const ringY = newRing(outW);
  const ringYY = newRing(outW);
  const ringXY = newRing(outW);
  const squares = new Float32Array(width);
  const products = new Float32Array(width);
  const accY = new Float64Array(outW);
  const accYY = new Float64Array(outW);
  const accXY = new Float64Array(outW);

  let total = 0;
  for (let row = 0; row < height; row++) {
    const base = row * width;
    for (let i = 0; i < width; i++) {
      const vy = y[base + i] ?? 0;
      squares[i] = vy * vy;
      products[i] = vy * (x[base + i] ?? 0);
    }
    const slot = row % WINDOW;
    filterRow(y, base, ringY[slot] ?? EMPTY, outW);
    filterRow(squares, 0, ringYY[slot] ?? EMPTY, outW);
    filterRow(products, 0, ringXY[slot] ?? EMPTY, outW);
    if (row < WINDOW - 1) continue;

    filterColumn(ringY, row, accY, outW);
    filterColumn(ringYY, row, accYY, outW);
    filterColumn(ringXY, row, accXY, outW);
    const obase = (row - WINDOW + 1) * outW;
    let rowTotal = 0;
    for (let col = 0; col < outW; col++) {
      const mx = mean[obase + col] ?? 0;
      const vx = variance[obase + col] ?? 0;
      const my = accY[col] ?? 0;
      const vy = (accYY[col] ?? 0) - my * my;
      const cov = (accXY[col] ?? 0) - mx * my;
      rowTotal +=
        ((2 * mx * my + C1) * (2 * cov + C2)) / ((mx * mx + my * my + C1) * (vx + vy + C2));
    }
    total += rowTotal;
  }
  return total / (outW * outH);
}

/** SSIM médio entre duas imagens do mesmo tamanho, sem cache. */
export function ssim(a: LumaImage, b: LumaImage): number {
  return ssimAgainst(prepareReference(a), b);
}

function globalSsim(x: Float32Array, y: Float32Array): number {
  const n = x.length;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i] ?? 0;
    my += y[i] ?? 0;
  }
  mx /= n;
  my /= n;
  let vx = 0;
  let vy = 0;
  let cov = 0;
  for (let i = 0; i < n; i++) {
    const dx = (x[i] ?? 0) - mx;
    const dy = (y[i] ?? 0) - my;
    vx += dx * dx;
    vy += dy * dy;
    cov += dx * dy;
  }
  vx /= n;
  vy /= n;
  cov /= n;
  return ((2 * mx * my + C1) * (2 * cov + C2)) / ((mx * mx + my * my + C1) * (vx + vy + C2));
}

// ─── Tarefas de medição (rodam na thread de medição, ou na própria nos testes) ──

/** Pixels crus de 8 bits, intercalados. */
export interface RawFrame {
  data: Uint8Array;
  width: number;
  height: number;
  channels: number;
}

/** A referência de uma largura: a luma composta e, havendo transparência, o alfa. */
export interface PreparedFrame {
  luma: SsimReference;
  /** Só quando o quadro tem pixels não opacos. */
  alpha: SsimReference | undefined;
}

export interface Measurement {
  ssim: number;
  /** SSIM do canal alfa, quando pedido. */
  alphaSsim: number | undefined;
}

export function prepareFrame(frame: RawFrame): PreparedFrame {
  const { data, width, height, channels } = frame;
  const alpha = alphaFromRaw(data, width, height, channels);
  return {
    luma: prepareReference(lumaFromRaw(data, width, height, channels)),
    alpha: alpha && !alpha.opaque ? prepareReference(alpha.image) : undefined,
  };
}

/**
 * Decodifica o encode sem conversão de cor (os valores ficam no espaço de
 * saída, como os da referência) e mede contra a referência preparada.
 */
export async function measureEncoded(
  reference: PreparedFrame,
  encoded: Uint8Array,
  withAlpha: boolean,
): Promise<Measurement> {
  const { data, info } = await sharp(encoded, { ignoreIcc: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const score = ssimAgainst(reference.luma, lumaFromRaw(data, width, height, channels));
  let alphaSsim: number | undefined;
  if (withAlpha && reference.alpha) {
    // Encode que perdeu o canal alfa conta como todo opaco.
    const alpha = alphaFromRaw(data, width, height, channels)?.image ?? {
      width,
      height,
      data: new Float32Array(width * height).fill(255),
    };
    alphaSsim = ssimAgainst(reference.alpha, alpha);
  }
  return { ssim: score, alphaSsim };
}
