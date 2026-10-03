import { randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { and, asc, desc, eq, ilike, isNull, sql } from 'drizzle-orm';

import { OUTBOX_EVENTS } from '@casebook/contracts';
import {
  checkUploadIntent,
  type CompleteUploadRequest,
  type CreateUploadRequest,
  type CreateUploadResponse,
  type MediaAssetDetailResponse,
  type MediaAssetResponse,
  type MediaListQuery,
  type MediaListResponse,
  RAW_NOT_SUPPORTED_MESSAGE,
  type UpdateMediaInput,
  UPLOAD_PART_SIZE,
  UPLOAD_URL_TTL_SECONDS,
  type UploadIntentCheck,
  VIDEO_NOT_AVAILABLE_MESSAGE,
} from '@casebook/contracts/media';
import {
  blockMedia,
  blocks,
  type Database,
  mediaAssets,
  mediaDerivatives,
  profiles,
  projects,
  type Transaction,
} from '@casebook/db';
import { isNoSuchUpload, type Storage, storageKeys } from '@casebook/storage';

import { PG_LOCK_NOT_AVAILABLE, PG_UNIQUE_VIOLATION, pgError } from '../common/pg-errors.js';
import { PROBLEM_TYPES, ProblemException } from '../common/problem.exception.js';
import { currentTraceparent } from '../common/tracing.js';
import { type ApiEnv, ENV } from '../config/env.js';
import { DB } from '../database/database.module.js';
import { appendOutboxEvent } from '../outbox/outbox.js';
import { STORAGE } from '../storage/storage.module.js';

import { MediaEventsService } from './media-events.service.js';
import { assertTransition, type MediaAssetRow, transitionMedia } from './media-state.js';
import { type SourceRow, toMediaDetailResponse, toMediaResponse } from './media.mapper.js';

const tracer = trace.getTracer('casebook-api');

export interface CreateUploadResult {
  status: HttpStatus.CREATED | HttpStatus.OK;
  body: CreateUploadResponse;
}

/** Espera máxima pela trava da linha no `complete` (outro `complete` em andamento). */
export const COMPLETE_LOCK_TIMEOUT_MS = 5_000;
/** Teto de cada consulta da transação do `complete`. */
const COMPLETE_STATEMENT_TIMEOUT_MS = 10_000;

/** Erros do S3 no `CompleteMultipartUpload` que são culpa das partes enviadas. */
const BAD_PARTS_ERRORS = new Set(['InvalidPart', 'InvalidPartOrder', 'EntityTooSmall']);

@Injectable()
export class MediaService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: Storage,
    @Inject(ENV) private readonly env: ApiEnv,
    private readonly events: MediaEventsService,
  ) {}

  /**
   * Intenção de upload (RF-UP-1): cria o asset em `pending` e o multipart no
   * storage, e devolve uma URL presigned por parte. Mesmo arquivo já na conta
   * (RF-UP-3) devolve o asset existente.
   */
  async createUpload(userId: string, input: CreateUploadRequest): Promise<CreateUploadResult> {
    const check = checkUploadIntent(input, { videoEnabled: this.env.MEDIA_VIDEO_ENABLED });
    if (!check.ok) throw intentProblem(check);

    const sha256 = Buffer.from(input.sha256, 'hex');
    const existing = await this.findBySha256(userId, sha256);
    if (existing) return this.deduplicated(existing);

    const mediaId = randomUUID();
    const bucket = this.storage.buckets.originals;
    const key = storageKeys.original(userId, mediaId);
    const uploadId = await this.storage.createMultipartUpload(bucket, key, input.mime);

    try {
      const [row] = await this.db
        .insert(mediaAssets)
        .values({
          id: mediaId,
          userId,
          kind: check.kind,
          state: 'pending',
          originalKey: key,
          // Tamanho declarado; o `complete` confere contra as partes recebidas.
          originalBytes: input.size_bytes,
          sha256,
          mime: input.mime,
          filename: input.filename,
          uploadId,
        })
        .returning();
      if (!row) throw new Error('INSERT em media_assets sem RETURNING');
      return {
        status: HttpStatus.CREATED,
        body: { asset: this.toResponse(row), deduplicated: false, upload: await this.presign(row) },
      };
    } catch (err) {
      await this.storage.abortMultipartUpload(bucket, key, uploadId).catch(() => undefined);
      // Duas intenções simultâneas do mesmo arquivo: a outra venceu o índice.
      const pg = pgError(err);
      if (pg?.code === PG_UNIQUE_VIOLATION && pg.constraint === 'media_dedupe') {
        const winner = await this.findBySha256(userId, sha256);
        if (winner) return this.deduplicated(winner);
      }
      throw err;
    }
  }

  /**
   * Fecha o multipart e, na mesma transação, passa o asset para `uploaded` e
   * grava o evento de outbox (RF-UP-2, ADR-4). Nada é enfileirado aqui: quem
   * publica no BullMQ é o relay, então uma queda do Redis não perde o job.
   */
  complete(
    userId: string,
    mediaId: string,
    input: CompleteUploadRequest,
  ): Promise<MediaAssetResponse> {
    return this.span('upload.complete', mediaId, () =>
      // A linha fica travada (FOR UPDATE) do começo ao fim, inclusive durante as
      // chamadas ao S3: um segundo `complete` simultâneo espera, encontra o asset
      // já em `uploaded` e recebe 409. Sem a trava, ele veria o multipart sumir
      // antes do commit do primeiro e não saberia distinguir de um upload expirado.
      this.db
        .transaction(async (tx) => {
          // A trava dura no máximo o tempo das duas chamadas ao S3 (cada uma com
          // prazo de S3_TIMEOUT_MS). Quem espera por ela desiste em 5s (409), e
          // nenhuma consulta da transação passa de 10s (503): um storage lento não
          // prende conexões do pool.
          await tx.execute(
            sql.raw(`SET LOCAL lock_timeout = '${String(COMPLETE_LOCK_TIMEOUT_MS)}ms'`),
          );
          await tx.execute(
            sql.raw(`SET LOCAL statement_timeout = '${String(COMPLETE_STATEMENT_TIMEOUT_MS)}ms'`),
          );
          const [asset] = await tx
            .select()
            .from(mediaAssets)
            .where(this.owned(userId, mediaId))
            .for('update');
          if (!asset) throw notFound();
          assertTransition('complete', asset.state);
          if (!asset.uploadId) throw new Error(`asset ${mediaId} em pending sem upload_id`);

          const bucket = this.storage.buckets.originals;
          const stored = await this.storage
            .listParts(bucket, asset.originalKey, asset.uploadId)
            .catch(onMissingUpload);
          const totalBytes = verifyParts(input, stored, asset.originalBytes ?? 0);

          await this.storage
            .completeMultipartUpload(
              bucket,
              asset.originalKey,
              asset.uploadId,
              stored.map((part) => ({ partNumber: part.partNumber, etag: part.etag })),
            )
            .catch((err: unknown) => {
              if (err instanceof Error && BAD_PARTS_ERRORS.has(err.name)) {
                throw uploadIncomplete(`O storage recusou as partes (${err.name}).`);
              }
              return onMissingUpload(err);
            });

          const updated = await transitionMedia(tx, {
            mediaId,
            userId,
            transition: 'complete',
            set: { uploadId: null, originalBytes: totalBytes },
          });
          await this.appendUploaded(tx, updated);
          return this.toResponse(updated);
        })
        .catch((err: unknown) => {
          if (pgError(err)?.code === PG_LOCK_NOT_AVAILABLE) {
            throw new ProblemException({
              status: HttpStatus.CONFLICT,
              type: PROBLEM_TYPES.busy,
              title: 'Upload sendo concluído',
              detail: 'Outra requisição está concluindo este upload. Tente de novo em instantes.',
              headers: { 'retry-after': '5' },
            });
          }
          throw err;
        })
        .then(async (asset) => {
          await this.publishQueued(userId, asset);
          return asset;
        }),
    );
  }

  /** De `failed` volta para `uploaded`, com evento de outbox novo (RF-MP-8). */
  retry(userId: string, mediaId: string): Promise<MediaAssetResponse> {
    return this.span('media.retry', mediaId, async () => {
      const row = await this.db.transaction(async (tx) => {
        const updated = await transitionMedia(tx, {
          mediaId,
          userId,
          transition: 'retry',
          set: { errorMessage: null },
        });
        await this.appendUploaded(tx, updated);
        return updated;
      });
      const asset = this.toResponse(row);
      await this.publishQueued(userId, asset);
      return asset;
    });
  }

  /** "Na fila": depois do commit, o card sai de "Enviando" sem esperar o worker. */
  private publishQueued(userId: string, asset: MediaAssetResponse): Promise<void> {
    return this.events.publish(userId, {
      media_id: asset.id,
      state: asset.state,
      stage: 'queued',
      progress: null,
      error_message: null,
      at: new Date().toISOString(),
    });
  }

  /**
   * Biblioteca (RF-LIB-1), mais recentes primeiro. O cursor é `(created_at, id)`
   * da última linha; `created_at` vai em microssegundos (a precisão do Postgres —
   * um `Date` truncaria para ms e repetiria ou pularia linhas).
   */
  async list(userId: string, query: MediaListQuery): Promise<MediaListResponse> {
    const conditions = [eq(mediaAssets.userId, userId), isNull(mediaAssets.deletedAt)];
    if (query.kind) conditions.push(eq(mediaAssets.kind, query.kind));
    if (query.state) conditions.push(eq(mediaAssets.state, query.state));
    // `ILIKE '%q%'` usa o índice trigram `media_filename_trgm`.
    if (query.q) conditions.push(ilike(mediaAssets.filename, `%${escapeLike(query.q)}%`));
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      conditions.push(
        sql`(${mediaAssets.createdAt}, ${mediaAssets.id}) < ('epoch'::timestamptz + ${cursor.micros}::bigint * interval '1 microsecond', ${cursor.id}::uuid)`,
      );
    }

    const rows = await this.db
      .select({
        asset: mediaAssets,
        micros: sql<string>`(extract(epoch from ${mediaAssets.createdAt}) * 1000000)::bigint::text`,
        // `media_assets.id` escrito por extenso: numa seleção de uma tabela só, o
        // Drizzle tira o nome da tabela das colunas interpoladas, e `d.media_id = "id"`
        // compararia com o id do próprio derivativo.
        sources: sql<SourceRow[] | null>`(
          SELECT json_agg(json_build_object(
            'format', d.format, 'width', d.width, 'storageKey', d.storage_key))
          FROM ${mediaDerivatives} d
          WHERE d.media_id = "media_assets"."id" AND d.kind = 'image'
        )`,
      })
      .from(mediaAssets)
      .where(and(...conditions))
      .orderBy(desc(mediaAssets.createdAt), desc(mediaAssets.id))
      .limit(query.limit + 1);

    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => this.toResponse(row.asset, row.sources ?? [])),
      next_cursor:
        rows.length > query.limit && last ? encodeCursor(last.micros, last.asset.id) : null,
    };
  }

  async get(userId: string, mediaId: string): Promise<MediaAssetDetailResponse> {
    const asset = await this.getOwned(userId, mediaId);
    const derivatives = await this.db
      .select()
      .from(mediaDerivatives)
      .where(eq(mediaDerivatives.mediaId, mediaId))
      .orderBy(asc(mediaDerivatives.format), asc(mediaDerivatives.width));
    return toMediaDetailResponse(this.storage, asset, derivatives);
  }

  /** RF-LIB-2: renomear e editar o texto alternativo. */
  async update(
    userId: string,
    mediaId: string,
    patch: UpdateMediaInput,
  ): Promise<MediaAssetResponse> {
    const [row] = await this.db
      .update(mediaAssets)
      .set({
        ...(patch.filename !== undefined && { filename: patch.filename }),
        ...(patch.alt_text !== undefined && { altText: patch.alt_text }),
        updatedAt: sql`now()`,
      })
      .where(this.owned(userId, mediaId))
      .returning();
    if (!row) throw notFound();
    return this.toResponse(row);
  }

  /**
   * Soft delete (RF-LIB-3). Em uso por algum bloco, exige `confirm`. Os objetos
   * no storage ficam: snapshots publicados apontam para os derivativos.
   */
  async remove(userId: string, mediaId: string, confirm: boolean): Promise<void> {
    await this.getOwned(userId, mediaId);

    const usedBy = await this.db
      .selectDistinct({ id: projects.id, title: projects.title, slug: projects.slug })
      .from(blockMedia)
      .innerJoin(blocks, eq(blocks.id, blockMedia.blockId))
      .innerJoin(projects, eq(projects.id, blocks.projectId))
      .where(and(eq(blockMedia.mediaId, mediaId), isNull(projects.deletedAt)))
      .orderBy(asc(projects.title));
    if (usedBy.length > 0 && !confirm) {
      throw new ProblemException({
        status: HttpStatus.CONFLICT,
        type: PROBLEM_TYPES.inUse,
        title: 'Mídia em uso',
        detail: 'A mídia é usada em projetos. Confirme para removê-la da biblioteca.',
        extensions: { requires_confirmation: true, projects: usedBy },
      });
    }

    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(mediaAssets)
        .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
        .where(this.owned(userId, mediaId))
        .returning({ id: mediaAssets.id });
      if (!row) throw notFound();
      // Avatar apontando para mídia apagada cairia num link quebrado.
      await tx
        .update(profiles)
        .set({ avatarMediaId: null, updatedAt: sql`now()` })
        .where(and(eq(profiles.userId, userId), eq(profiles.avatarMediaId, mediaId)));
    });
  }

  // ─── apoio ──────────────────────────────────────────────────────────────────

  private owned(userId: string, mediaId: string) {
    // RNF-9: toda leitura e escrita filtra pelo dono; asset de outro usuário é 404.
    return and(
      eq(mediaAssets.id, mediaId),
      eq(mediaAssets.userId, userId),
      isNull(mediaAssets.deletedAt),
    );
  }

  private async getOwned(userId: string, mediaId: string): Promise<MediaAssetRow> {
    const [row] = await this.db.select().from(mediaAssets).where(this.owned(userId, mediaId));
    if (!row) throw notFound();
    return row;
  }

  private async findBySha256(userId: string, sha256: Buffer): Promise<MediaAssetRow | undefined> {
    const [row] = await this.db
      .select()
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.userId, userId),
          eq(mediaAssets.sha256, sha256),
          isNull(mediaAssets.deletedAt),
        ),
      );
    return row;
  }

  /**
   * Arquivo já na conta. Em `pending` é outra aba retomando o mesmo upload: URLs
   * novas para o mesmo `upload_id`. Nos demais estados não há o que enviar.
   */
  private async deduplicated(row: MediaAssetRow): Promise<CreateUploadResult> {
    if (row.state === 'pending') {
      return {
        status: HttpStatus.OK,
        body: { asset: this.toResponse(row), deduplicated: false, upload: await this.presign(row) },
      };
    }
    return {
      status: HttpStatus.OK,
      body: { asset: this.toResponse(row), deduplicated: true, upload: null },
    };
  }

  private async presign(row: MediaAssetRow): Promise<NonNullable<CreateUploadResponse['upload']>> {
    if (!row.uploadId) throw new Error(`asset ${row.id} em pending sem upload_id`);
    const expiresAt = new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000);
    const parts = await this.storage.presignUploadParts({
      bucket: this.storage.buckets.originals,
      key: row.originalKey,
      uploadId: row.uploadId,
      partCount: partCount(row.originalBytes ?? 0),
      expiresInSec: UPLOAD_URL_TTL_SECONDS,
    });
    return { part_size: UPLOAD_PART_SIZE, parts, expires_at: expiresAt.toISOString() };
  }

  private async appendUploaded(tx: Transaction, asset: MediaAssetRow): Promise<void> {
    await appendOutboxEvent(tx, {
      aggregate: 'media_asset',
      aggregateId: asset.id,
      eventType: OUTBOX_EVENTS.mediaUploaded,
      payload: { traceparent: currentTraceparent(), media_id: asset.id, kind: asset.kind },
    });
  }

  private toResponse(row: MediaAssetRow, sources: SourceRow[] = []): MediaAssetResponse {
    return toMediaResponse(this.storage, row, sources);
  }

  private span<T>(name: string, mediaId: string, fn: () => Promise<T>): Promise<T> {
    return tracer.startActiveSpan(name, { attributes: { 'media.id': mediaId } }, async (span) => {
      try {
        return await fn();
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw err;
      } finally {
        span.end();
      }
    });
  }
}

/**
 * O multipart sumiu com a linha travada em `pending`: o GC o abortou (24h) ou ele
 * expirou no storage. O cliente precisa recomeçar o upload.
 */
function onMissingUpload(err: unknown): never {
  if (!isNoSuchUpload(err)) throw err;
  throw uploadIncomplete('O upload expirou. Envie o arquivo de novo.');
}

function partCount(bytes: number): number {
  return Math.max(1, Math.ceil(bytes / UPLOAD_PART_SIZE));
}

/**
 * As partes que o cliente diz ter enviado precisam ser exatamente as que o
 * storage recebeu (mesmos ETags), e somar o tamanho declarado na intenção. Isso
 * também barra quem declarou 1 MB e mandou 5 GB pelas URLs presigned.
 */
function verifyParts(
  input: CompleteUploadRequest,
  stored: { partNumber: number; etag: string; size: number }[],
  declaredBytes: number,
): number {
  const expected = partCount(declaredBytes);
  const byNumber = new Map(stored.map((part) => [part.partNumber, part]));
  const matches =
    stored.length === expected &&
    input.parts.length === expected &&
    input.parts.every((part) => {
      const found = byNumber.get(part.part_number);
      return found !== undefined && unquote(found.etag) === unquote(part.etag);
    });
  if (!matches) {
    throw uploadIncomplete(
      `O storage recebeu ${String(stored.length)} de ${String(expected)} partes, ou os ETags não conferem.`,
    );
  }
  const total = stored.reduce((sum, part) => sum + part.size, 0);
  if (total !== declaredBytes) {
    throw uploadIncomplete(
      `O arquivo enviado tem ${String(total)} bytes; a intenção declarou ${String(declaredBytes)}.`,
    );
  }
  return total;
}

function unquote(etag: string): string {
  return etag.replaceAll('"', '');
}

function intentProblem(check: Extract<UploadIntentCheck, { ok: false }>): ProblemException {
  switch (check.reason) {
    case 'raw':
      return new ProblemException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        type: PROBLEM_TYPES.rawNotSupported,
        title: 'Arquivo RAW não aceito',
        detail: RAW_NOT_SUPPORTED_MESSAGE,
      });
    case 'video_disabled':
      return new ProblemException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        type: PROBLEM_TYPES.videoNotAvailable,
        title: 'Vídeo ainda não disponível',
        detail: VIDEO_NOT_AVAILABLE_MESSAGE,
      });
    case 'unsupported_type':
      return fieldError('/mime', 'Formato não aceito. Use JPEG, PNG, TIFF, HEIC, WebP ou AVIF.');
    case 'too_large':
      return fieldError(
        '/size_bytes',
        `O arquivo passa do limite de ${String(check.maxBytes / 1024 / 1024)} MB.`,
      );
  }
}

function fieldError(pointer: string, detail: string): ProblemException {
  return new ProblemException({
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    type: PROBLEM_TYPES.validation,
    title: 'Requisição inválida',
    detail,
    errors: [{ pointer, detail }],
  });
}

function uploadIncomplete(detail: string): ProblemException {
  return new ProblemException({
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    type: PROBLEM_TYPES.uploadIncomplete,
    title: 'Upload incompleto',
    detail,
  });
}

function notFound(): NotFoundException {
  return new NotFoundException('Mídia não encontrada');
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function encodeCursor(micros: string, id: string): string {
  return Buffer.from(JSON.stringify([micros, id])).toString('base64url');
}

function decodeCursor(cursor: string): { micros: string; id: string } {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(value) &&
      typeof value[0] === 'string' &&
      /^\d{1,19}$/.test(value[0]) &&
      typeof value[1] === 'string' &&
      /^[\da-f-]{36}$/i.test(value[1])
    ) {
      return { micros: value[0], id: value[1] };
    }
  } catch {
    // cai no erro abaixo
  }
  throw fieldError('/cursor', 'Cursor inválido');
}
