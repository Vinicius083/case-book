import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { bytea } from './types.js';
import { users } from './users.js';

export const mediaKind = pgEnum('media_kind', ['image', 'video']);
export const mediaState = pgEnum('media_state', [
  'pending',
  'uploaded',
  'processing',
  'ready',
  'failed',
]);
export const jobState = pgEnum('job_state', ['queued', 'running', 'succeeded', 'failed', 'dead']);

export const mediaAssets = pgTable(
  'media_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: mediaKind('kind').notNull(),
    state: mediaState('state').notNull().default('pending'),
    originalKey: text('original_key').notNull(),
    originalBytes: bigint('original_bytes', { mode: 'number' }),
    sha256: bytea('sha256').notNull(),
    mime: text('mime').notNull(),
    filename: text('filename').notNull(),
    altText: text('alt_text'),
    width: integer('width'),
    height: integer('height'),
    // Formato definido na Sprint 2 (extração de paleta).
    palette: jsonb('palette').$type<Record<string, unknown>>(),
    exif: jsonb('exif').$type<Record<string, unknown>>(),
    uploadId: text('upload_id'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    check(
      'dims_when_ready',
      sql`${t.state} <> 'ready' OR (${t.width} IS NOT NULL AND ${t.height} IS NOT NULL)`,
    ),
    uniqueIndex('media_dedupe')
      .on(t.userId, t.sha256)
      .where(sql`${t.deletedAt} IS NULL`),
    // `.desc()` sozinho gera DESC NULLS LAST; o DESC do DDL é NULLS FIRST (padrão do
    // Postgres), que é o que um `ORDER BY created_at DESC` usa.
    index('media_by_user')
      .on(t.userId, t.createdAt.desc().nullsFirst())
      .where(sql`${t.deletedAt} IS NULL`),
    index('media_pending_gc')
      .on(t.createdAt)
      .where(sql`${t.state} = 'pending'`),
  ],
);

// Atributos exclusivos de vídeo, fora da tabela quente (ADR-2).
export const videoAssets = pgTable('video_assets', {
  mediaId: uuid('media_id')
    .primaryKey()
    .references(() => mediaAssets.id, { onDelete: 'cascade' }),
  durationMs: integer('duration_ms').notNull(),
  fps: numeric('fps', { precision: 6, scale: 3 }),
  videoCodec: text('video_codec'),
  audioCodec: text('audio_codec'),
  bitrateBps: bigint('bitrate_bps', { mode: 'number' }),
  hasAudio: boolean('has_audio').notNull().default(true),
  hlsMasterKey: text('hls_master_key'),
  posterKey: text('poster_key'),
  posterFrameMs: integer('poster_frame_ms'),
});

export const mediaDerivatives = pgTable(
  'media_derivatives',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // 'image' | 'hls_variant' | 'poster'
    format: text('format').notNull(), // 'avif' | 'webp' | 'jpeg' | 'm3u8'
    width: integer('width'),
    height: integer('height'),
    bytes: bigint('bytes', { mode: 'number' }).notNull(),
    storageKey: text('storage_key').notNull(),
    ssim: numeric('ssim', { precision: 6, scale: 5 }),
    quality: integer('quality'),
    bitrateBps: integer('bitrate_bps'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Idempotência de reprocessamento (RNF-7).
    uniqueIndex('derivative_unique').on(t.mediaId, t.kind, t.format, sql`COALESCE(${t.width}, -1)`),
  ],
);

export const mediaJobs = pgTable(
  'media_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'cascade' }),
    jobType: text('job_type').notNull(), // 'image.process' | 'video.transcode'
    state: jobState('state').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    traceId: text('trace_id'), // amarra o job ao trace HTTP (RNF-11)
    queuedAt: timestamp('queued_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    error: text('error'),
  },
  (t) => [index('jobs_by_media').on(t.mediaId, t.queuedAt.desc().nullsFirst())],
);
