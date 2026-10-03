import sharp from 'sharp';

import { MAX_INPUT_PIXELS } from './sniff.js';
import { type SsimRunner } from './ssim-pool.js';
import { type PreparedFrame } from './ssim.js';

/** Larguras do RF-MP-1 (nunca upscale). */
export const STANDARD_WIDTHS = [320, 640, 1024, 1600, 2400, 3840] as const;
/** Largura do JPEG de fallback e da busca de referência. */
export const REFERENCE_WIDTH = 1600;
export const SSIM_TARGET = 0.985;
/**
 * Faixa da busca por formato, e o teto: a qualidade máxima do encoder, tentada
 * só quando nem o máximo da faixa alcança o alvo. As faixas começam onde o
 * formato costuma chegar perto de 0,985 — abaixo disso a busca só gastaria
 * encodes. Cinco passos resolvem 31 valores: os 21 de WebP e JPEG saem exatos;
 * nos 36 do AVIF a qualidade escolhida pode ficar 1 ponto acima da mínima.
 */
export const QUALITY = {
  avif: { min: 55, max: 90, ceiling: 98 },
  webp: { min: 75, max: 95, ceiling: 100 },
  jpeg: { min: 75, max: 95, ceiling: 100 },
} as const;
export const SEARCH_STEPS = 5;
/** Na aplicação em outras larguras: quanto subir a qualidade, e quantas vezes. */
export const QUALITY_BUMP = 5;
export const MAX_BUMPS = 2;
/**
 * Esforço do encoder AVIF (0–9). Medido em 1600px: o esforço 4 (padrão) custa
 * 2,1 s por encode contra 0,25 s do 2, para um arquivo 2 a 5% menor.
 */
export const AVIF_EFFORT = 2;
/** Fundo do JPEG de fallback de imagens com transparência, o mesmo do SSIM. */
export const ALPHA_BACKGROUND_HEX = '#808080';

export type DerivativeFormat = 'avif' | 'webp' | 'jpeg';
export type OutputProfile = 'srgb' | 'p3';

/** O original já normalizado: orientação e plano de cor decididos. */
export interface Source {
  /** Arquivo original (ou o TIFF decodificado do HEIC). */
  path: string;
  /** Dimensões depois da rotação EXIF. */
  width: number;
  height: number;
  /** `p3` quando a origem tem gamut maior que sRGB. */
  output: OutputProfile;
  /** Origem em tons de cinza (1–2 canais): sai como RGB. */
  grey: boolean;
}

/** Pixels de 8 bits, no espaço de saída, numa largura. A referência do SSIM. */
export interface Frame {
  width: number;
  height: number;
  channels: number;
  data: Buffer;
  output: OutputProfile;
}

export interface Derivative {
  format: DerivativeFormat;
  width: number;
  height: number;
  quality: number;
  /**
   * SSIM medido. No AVIF de imagem com transparência, o menor entre o da imagem
   * composta e o do canal alfa (`alphaSsim`).
   */
  ssim: number;
  /** SSIM do canal alfa (só AVIF de imagem com transparência). */
  alphaSsim: number | undefined;
  /** `false`: nem a qualidade máxima do formato alcançou o alvo. */
  targetMet: boolean;
  data: Buffer;
}

export interface DerivativeStats {
  encodes: number;
  /** Relógio de cada fase: quadro e referência da largura de referência, busca, demais larguras. */
  referenceFrameMs: number;
  searchMs: number;
  widthsMs: number;
  /** Somas dos tempos das tarefas. Elas se sobrepõem: a soma passa do relógio. */
  frameMs: number;
  encodeMs: number;
  ssimMs: number;
  referenceWidth: number;
  /** Qualidade encontrada na busca de referência, por formato. */
  referenceQuality: Record<DerivativeFormat, number>;
  /** Derivativos que ficaram abaixo do alvo mesmo no teto do formato. */
  targetMissed: number;
}

export interface GenerateOptions {
  /** Quem mede o SSIM: a fatia do pool de threads do job. */
  ssim: SsimRunner;
  /** Larguras processadas ao mesmo tempo depois da referência. Padrão: 1. */
  parallelWidths?: number;
  /** Chamado a cada encode: `done` de `total` (estimativa, nunca menor que `done`). */
  onProgress?: (done: number, total: number) => void;
  /** Injetáveis nos testes. Padrão: `normalizedFrame` e `encode`. */
  frameFor?: (source: Source, width: number) => Promise<Frame>;
  encode?: typeof encode;
}

/** Larguras a gerar: as do RF-MP-1 que cabem, mais a própria largura se for menor que 3840. */
export function planWidths(originalWidth: number): number[] {
  const widths: number[] = STANDARD_WIDTHS.filter((w) => w <= originalWidth);
  const largest = STANDARD_WIDTHS[STANDARD_WIDTHS.length - 1] ?? 0;
  if (originalWidth < largest && !widths.includes(originalWidth)) widths.push(originalWidth);
  return widths;
}

/** Largura da busca de referência e do JPEG: 1600, ou a maior disponível se a imagem for menor. */
export function referenceWidth(widths: readonly number[]): number {
  const fits = widths.filter((w) => w <= REFERENCE_WIDTH);
  return fits.length > 0 ? Math.max(...fits) : Math.min(...widths);
}

/**
 * Um passe a partir do original: cada largura sai do arquivo original
 * (rotacionado e com a cor normalizada) redimensionado direto para ela — nunca
 * de outro derivativo nem de outra largura já reduzida.
 */
export async function normalizedFrame(source: Source, width: number): Promise<Frame> {
  let image = sharp(source.path, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' }).rotate();
  // 16 bits só para fonte de gamut largo (P3, Adobe RGB, ProPhoto): aí o sharp
  // trabalha em Display P3 em vez de sRGB (`processingProfile` no pipeline.cc) e
  // a cor fora do sRGB não é recortada. Fonte sRGB segue em 8 bits, que é mais
  // rápido e não muda o resultado.
  if (source.output === 'p3') image = image.pipelineColourspace('rgb16');
  image = image.resize({ width, withoutEnlargement: true, kernel: 'lanczos3' });
  if (source.grey) image = image.toColourspace('srgb');
  const { data, info } = await image
    .withIccProfile(source.output)
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    channels: info.channels,
    data,
    output: source.output,
  };
}

/** Encode a partir do quadro, sem metadados e com o ICC da saída embutido. */
export async function encode(
  frame: Frame,
  format: DerivativeFormat,
  quality: number,
): Promise<Buffer> {
  let image = sharp(frame.data, {
    raw: { width: frame.width, height: frame.height, channels: frame.channels as 1 | 2 | 3 | 4 },
  });
  // O quadro já está no espaço de saída. Em P3, o pipeline de 16 bits faz o
  // perfil de trabalho ser P3, e o `withIccProfile('p3')` vira identidade + anexo.
  if (frame.output === 'p3') image = image.pipelineColourspace('rgb16');
  image = image.withIccProfile(frame.output);
  switch (format) {
    case 'avif':
      return image.avif({ quality, effort: AVIF_EFFORT, chromaSubsampling: '4:2:0' }).toBuffer();
    case 'webp':
      // `alphaQuality` fica no padrão (100): o alfa do WebP sai sem perda.
      return image.webp({ quality, effort: 4 }).toBuffer();
    case 'jpeg':
      // JPEG não tem alfa: achatado sobre o mesmo cinza usado no SSIM.
      return image
        .flatten({ background: ALPHA_BACKGROUND_HEX })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
  }
}

/**
 * Derivativos AVIF e WebP em todas as larguras, mais o JPEG de fallback, com
 * qualidade guiada por SSIM (RF-MP-2):
 *
 * 1. **Referência:** busca binária da menor qualidade da faixa do formato (5
 *    passos) com SSIM ≥ 0,985, só na largura de referência, para AVIF, WebP e
 *    JPEG — os três ao mesmo tempo.
 * 2. **Aplicação:** nas outras larguras, a qualidade da referência; mede o SSIM
 *    e, abaixo do alvo, sobe 5 pontos (até 2 vezes) e depois vai ao máximo da
 *    faixa.
 * 3. **Teto:** se nem o máximo da faixa alcança o alvo, um último encode na
 *    qualidade máxima do formato. Se ainda assim não alcançar, o derivativo é
 *    aceito com o SSIM real e `targetMet = false`.
 *
 * Todo SSIM é medido na imagem inteira, contra a referência da largura
 * calculada uma vez (`SsimRunner.prepare`), em threads próprias — enquanto uma
 * mede, o libvips já codifica o próximo.
 *
 * Ingenuamente seriam até 6 larguras × 2 formatos × 5 passos = 60 encodes; assim
 * ficam ~15 na referência e ~1 por largura restante.
 */
export async function generateDerivatives(
  source: Source,
  options: GenerateOptions,
): Promise<{ derivatives: Derivative[]; stats: DerivativeStats }> {
  const frameFor = options.frameFor ?? normalizedFrame;
  const encodeFrame = options.encode ?? encode;
  const { ssim } = options;
  const widths = planWidths(source.width);
  const refWidth = referenceWidth(widths);
  const stats: DerivativeStats = {
    encodes: 0,
    referenceFrameMs: 0,
    searchMs: 0,
    widthsMs: 0,
    frameMs: 0,
    encodeMs: 0,
    ssimMs: 0,
    referenceWidth: refWidth,
    referenceQuality: { avif: 0, webp: 0, jpeg: 0 },
    targetMissed: 0,
  };
  // Estimativa para o progresso: busca completa nos 3 formatos + 1 encode por
  // largura restante em AVIF e WebP. Retentativas só aumentam o total.
  let total = 3 * SEARCH_STEPS + 2 * (widths.length - 1);
  // Depois da primeira falha, as tarefas ainda na fila desistem em vez de
  // gastar CPU num job que já vai falhar.
  let failed = false;

  const timed = async <T>(key: 'frameMs' | 'encodeMs' | 'ssimMs', fn: () => Promise<T>) => {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      stats[key] += performance.now() - start;
    }
  };
  const phase = async <T>(
    key: 'referenceFrameMs' | 'searchMs' | 'widthsMs',
    fn: () => Promise<T>,
  ) => {
    const start = performance.now();
    try {
      return await fn();
    } catch (err) {
      failed = true;
      throw err;
    } finally {
      stats[key] = performance.now() - start;
    }
  };

  /** Quadro de uma largura e a sua referência de SSIM, calculada em paralelo com os encodes. */
  const open = async (width: number) => {
    const frame = await timed('frameMs', () => frameFor(source, width));
    return { frame, reference: timed('ssimMs', () => ssim.prepare(frame)) };
  };
  type Opened = Awaited<ReturnType<typeof open>>;

  const attempt = async (
    { frame, reference }: Opened,
    format: DerivativeFormat,
    quality: number,
  ): Promise<Derivative> => {
    if (failed) throw new Error('geração de derivativos interrompida');
    const data = await timed('encodeMs', () => encodeFrame(frame, format, quality));
    const prepared: PreparedFrame = await reference;
    // O alfa do AVIF é codificado com perda, na mesma qualidade da cor: medido à
    // parte, e vale o pior dos dois. O do WebP sai sem perda; o JPEG não tem.
    const measured = await timed('ssimMs', () => ssim.measure(prepared, data, format === 'avif'));
    const score = Math.min(measured.ssim, measured.alphaSsim ?? 1);
    stats.encodes++;
    total = Math.max(total, stats.encodes);
    options.onProgress?.(stats.encodes, total);
    return {
      format,
      width: frame.width,
      height: frame.height,
      quality,
      ssim: score,
      alphaSsim: measured.alphaSsim,
      targetMet: score >= SSIM_TARGET,
      data,
    };
  };

  /** Tenta as qualidades em ordem e fica com a primeira que alcança o alvo, ou com a última. */
  const escalate = async (
    opened: Opened,
    format: DerivativeFormat,
    qualities: number[],
  ): Promise<Derivative> => {
    let result: Derivative | undefined;
    for (const quality of [...new Set(qualities)]) {
      result = await attempt(opened, format, quality);
      if (result.targetMet) break;
    }
    if (!result) throw new Error('nenhuma qualidade para tentar');
    if (!result.targetMet) stats.targetMissed++;
    return result;
  };

  const search = async (opened: Opened, format: DerivativeFormat): Promise<Derivative> => {
    const { min, max, ceiling } = QUALITY[format];
    let lo = min;
    let hi = max;
    let best: Derivative | undefined;
    let triedMax = false;
    for (let step = 0; step < SEARCH_STEPS && lo <= hi; step++) {
      const quality = Math.round((lo + hi) / 2);
      const candidate = await attempt(opened, format, quality);
      triedMax ||= quality === max;
      if (candidate.targetMet) {
        best = candidate;
        hi = quality - 1;
      } else {
        lo = quality + 1;
      }
    }
    // Nada na faixa alcançou o alvo (ex.: ruído fino): o teto do formato.
    best ??= await escalate(opened, format, triedMax ? [ceiling] : [max, ceiling]);
    stats.referenceQuality[format] = best.quality;
    return best;
  };

  const apply = (opened: Opened, format: DerivativeFormat): Promise<Derivative> => {
    const { max, ceiling } = QUALITY[format];
    const start = stats.referenceQuality[format];
    const bumps = Array.from({ length: MAX_BUMPS }, (_, i) =>
      Math.min(max, start + QUALITY_BUMP * (i + 1)),
    );
    // A referência já pode ter ido ao teto; aí não há para onde subir.
    return escalate(
      opened,
      format,
      start >= max ? [start, ceiling] : [start, ...bumps, max, ceiling],
    );
  };

  const refOpened = await phase('referenceFrameMs', async () => {
    const opened = await open(refWidth);
    await opened.reference;
    return opened;
  });
  const derivatives = await phase('searchMs', () =>
    Promise.all((['avif', 'webp', 'jpeg'] as const).map((format) => search(refOpened, format))),
  );

  // As demais larguras, da maior para a menor (as caras primeiro, em paralelo).
  const pending = widths.filter((width) => width !== refWidth).sort((a, b) => b - a);
  const lane = async () => {
    for (let width = pending.shift(); width !== undefined; width = pending.shift()) {
      if (failed) return;
      const opened = await open(width);
      const [done] = await Promise.all([
        Promise.all((['avif', 'webp'] as const).map((format) => apply(opened, format))),
        opened.reference,
      ]);
      derivatives.push(...done);
    }
  };
  await phase('widthsMs', () =>
    Promise.all(Array.from({ length: Math.max(1, options.parallelWidths ?? 1) }, lane)),
  );

  const order = { avif: 0, webp: 1, jpeg: 2 } as const;
  derivatives.sort((a, b) => order[a.format] - order[b.format] || a.width - b.width);
  return { derivatives, stats };
}
