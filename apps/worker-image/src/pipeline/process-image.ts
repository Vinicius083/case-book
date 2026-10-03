import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { type Attributes, type Span, SpanStatusCode, trace } from '@opentelemetry/api';
import { UnrecoverableError } from 'bullmq';

import { type ImageProcessJob } from '@casebook/contracts';
import { type MediaColor } from '@casebook/contracts/media';
import type { Database } from '@casebook/db';
import {
  contentHash8,
  IMMUTABLE_CACHE_CONTROL,
  type Storage,
  storageKeys,
} from '@casebook/storage';

import { type Derivative, generateDerivatives, type Source } from './derivatives.js';
import { PermanentImageError, USER_MESSAGES, userMessageFor } from './errors.js';
import { MediaEventPublisher } from './events.js';
import { decodeHeic, type HeifDecoder } from './heic.js';
import { describeIcc } from './icc.js';
import { readExif } from './metadata.js';
import { extractPalette } from './palette.js';
import { sniff } from './sniff.js';
import { type SsimPool } from './ssim-pool.js';
import {
  failProcessing,
  finishProcessing,
  recordAttempt,
  recordRetry,
  startProcessing,
  type StoredDerivative,
} from './store.js';

import type { Redis } from 'ioredis';

const tracer = trace.getTracer('casebook-worker-image');

const CONTENT_TYPES = { avif: 'image/avif', webp: 'image/webp', jpeg: 'image/jpeg' } as const;
/** Uploads de derivativos em paralelo. */
const UPLOAD_CONCURRENCY = 4;
/** Prazo do download do original (até 50 MB). */
const DOWNLOAD_TIMEOUT_MS = 120_000;

export interface ImageProcessDeps {
  db: Database;
  storage: Storage;
  /** Conexão para PUBLISH dos eventos (não a do BullMQ). */
  publisher: Redis;
  tmpRoot: string;
  heif: HeifDecoder;
  /** Threads de medição do SSIM, compartilhadas pelos jobs do processo. */
  ssimPool: SsimPool;
  /** Núcleos que cabem a cada job (os do processo divididos pela concorrência). */
  threadsPerJob: number;
  logger?: Pick<Console, 'log' | 'error'>;
}

export interface JobAttempt {
  /** 1 na primeira tentativa. */
  attempt: number;
  maxAttempts: number;
}

export type ProcessOutcome = 'ready' | 'skipped';

/**
 * Pipeline do `image.process` (RF-MP-1 a 4, 7, 8). Roda dentro do span
 * `image.process` aberto pelo processor; cada etapa tem span próprio.
 */
export async function processImage(
  data: ImageProcessJob,
  attempt: JobAttempt,
  deps: ImageProcessDeps,
): Promise<ProcessOutcome> {
  const logger = deps.logger ?? console;
  const traceId = trace.getActiveSpan()?.spanContext().traceId ?? '';

  const asset = await step('image.transition', {}, () =>
    startProcessing(deps.db, data.media_id, attempt.attempt > 1),
  );
  if (!asset) {
    logger.log(`[image] mídia ${data.media_id} não está aguardando processamento; job ignorado`);
    return 'skipped';
  }
  const jobId = await recordAttempt(deps.db, asset.id, attempt.attempt, traceId);
  const events = new MediaEventPublisher(deps.publisher, asset.userId, asset.id, (err) => {
    logger.error(`[image] falha ao publicar evento: ${String(err)}`);
  });
  events.progress('optimizing', 0);

  const workDir = await mkdtemp(join(deps.tmpRoot, `img-${asset.id}-`));
  try {
    // 2. Download em stream, com o SHA-256 calculado no caminho.
    const originalPath = join(workDir, 'original');
    await step('image.download', {}, async (span) => {
      const { bytes, sha256 } = await deps.storage.downloadToFile(
        deps.storage.buckets.originals,
        asset.originalKey,
        originalPath,
        { timeoutMs: DOWNLOAD_TIMEOUT_MS },
      );
      span.setAttribute('image.original_bytes', bytes);
      if (sha256 !== asset.sha256.toString('hex')) {
        throw new PermanentImageError(
          USER_MESSAGES.hashMismatch,
          `sha256 do original (${sha256}) difere do declarado (${asset.sha256.toString('hex')})`,
        );
      }
    });

    // 3–5. Formato pelo conteúdo, RAW em TIFF, teto de pixels; HEIC convertido.
    let sniffed = await step('image.sniff', {}, async (span) => {
      const result = await sniff(originalPath);
      span.setAttributes({
        'image.format': result.format,
        'image.width': result.width,
        'image.height': result.height,
      });
      return result;
    });
    let pixelsPath = originalPath;
    if (sniffed.format === 'heic') {
      pixelsPath = await step('image.heic', { 'heif.decoder': deps.heif.bin }, () =>
        decodeHeic(deps.heif, originalPath, workDir),
      );
      // O decodificado já vem rotacionado (o libheif aplica `irot`/`imir`).
      sniffed = { ...(await sniff(pixelsPath)), orientation: 1 };
    }

    // 6. Metadados: EXIF do arquivo enviado, cor do ICC; GPS nunca é lido.
    const icc = describeIcc(sniffed.icc);
    const color: MediaColor = {
      source_profile: icc.description,
      source_wide_gamut: icc.wideGamut,
      output_profile: icc.wideGamut ? 'Display P3' : 'sRGB',
    };
    const exif = await step('image.metadata', {}, async () => ({
      ...(await readExif(originalPath)),
      color,
    }));
    const rotated = (sniffed.orientation ?? 1) >= 5;
    const source: Source = {
      path: pixelsPath,
      width: rotated ? sniffed.height : sniffed.width,
      height: rotated ? sniffed.width : sniffed.height,
      output: icc.wideGamut ? 'p3' : 'srgb',
      grey: sniffed.channels < 3,
    };

    // 7–8. Derivativos com qualidade guiada por SSIM.
    const { derivatives } = await step(
      'image.derivatives',
      { 'image.output_profile': color.output_profile },
      async (span) => {
        const result = await generateDerivatives(source, {
          ssim: deps.ssimPool.forJob(deps.threadsPerJob),
          // Cada largura já ocupa duas frentes (AVIF e WebP).
          parallelWidths: Math.floor(deps.threadsPerJob / 2),
          onProgress: (done, total) => {
            events.progress('optimizing', (done / total) * 100);
          },
        });
        const bytes = result.derivatives.reduce((sum, d) => sum + d.data.length, 0);
        span.setAttributes({
          'image.encodes': result.stats.encodes,
          'image.derivatives': result.derivatives.length,
          'image.reference_frame_ms': Math.round(result.stats.referenceFrameMs),
          'image.search_ms': Math.round(result.stats.searchMs),
          'image.widths_ms': Math.round(result.stats.widthsMs),
          'image.frame_ms': Math.round(result.stats.frameMs),
          'image.encode_ms': Math.round(result.stats.encodeMs),
          'image.ssim_ms': Math.round(result.stats.ssimMs),
          'image.reference_width': result.stats.referenceWidth,
          'image.quality.avif': result.stats.referenceQuality.avif,
          'image.quality.webp': result.stats.referenceQuality.webp,
          'image.quality.jpeg': result.stats.referenceQuality.jpeg,
          'image.ssim_min': Math.min(...result.derivatives.map((d) => d.ssim)),
          'image.ssim_target_missed': result.stats.targetMissed,
          'image.derivatives_bytes': bytes,
          // RNF-10: derivativos ≤ 2,5× o original.
          'image.bytes_ratio': asset.originalBytes ? bytes / asset.originalBytes : 0,
        });
        return result;
      },
    );

    // 9. Paleta, sempre em sRGB.
    events.progress('palette', null);
    const palette = await step('image.palette', {}, () => extractPalette(pixelsPath));

    // 10. Upload (chave com hash do conteúdo, imutável) e uma transação só.
    const stored = await step(
      'derivative.upload',
      { 'image.derivatives': derivatives.length },
      () => uploadAll(deps.storage, asset.id, derivatives),
    );
    const updated = await step('image.persist', {}, () =>
      finishProcessing(deps.db, {
        mediaId: asset.id,
        jobId,
        width: source.width,
        height: source.height,
        palette,
        exif,
        derivatives: stored,
      }),
    );
    if (!updated) {
      logger.log(
        `[image] mídia ${asset.id} saiu de processing durante o job; resultado descartado`,
      );
      return 'skipped';
    }

    // 11. Evento depois do commit.
    await step('image.publish', {}, () => events.final('ready', null));
    return 'ready';
  } catch (err) {
    const final = err instanceof UnrecoverableError || attempt.attempt >= attempt.maxAttempts;
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    if (final) {
      const userMessage = userMessageFor(err);
      await failProcessing(deps.db, { mediaId: asset.id, jobId, userMessage, detail });
      await events.final('failed', userMessage);
    } else {
      await recordRetry(deps.db, jobId, detail);
    }
    throw err;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function uploadAll(
  storage: Storage,
  mediaId: string,
  derivatives: Derivative[],
): Promise<StoredDerivative[]> {
  const queue = [...derivatives];
  const stored: StoredDerivative[] = [];
  const worker = async () => {
    for (let d = queue.shift(); d; d = queue.shift()) {
      const key = storageKeys.derivative({
        mediaId,
        width: d.width,
        contentHash8: contentHash8(d.data),
        format: d.format,
      });
      await storage.putObject({
        bucket: storage.buckets.media,
        key,
        body: d.data,
        contentType: CONTENT_TYPES[d.format],
        cacheControl: IMMUTABLE_CACHE_CONTROL,
      });
      stored.push({
        format: d.format,
        width: d.width,
        height: d.height,
        bytes: d.data.length,
        storageKey: key,
        ssim: d.ssim,
        ssimTargetMet: d.targetMet,
        quality: d.quality,
      });
    }
  };
  await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, worker));
  return stored;
}

/** Etapa com span próprio, filho do span ativo (`image.process`). */
function step<T>(name: string, attributes: Attributes, fn: (span: Span) => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn(span);
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  });
}
