import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  foreignKey,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { mediaAssets } from './media.js';
import { citext } from './types.js';
import { users } from './users.js';

export const projectStatus = pgEnum('project_status', ['draft', 'published', 'unlisted']);

/** Snapshot publicado. Tipo real (union dos blocos) entra na Sprint 3. */
export type ProjectDocument = Record<string, unknown>;

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    slug: citext('slug').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'`),
    coverMediaId: uuid('cover_media_id').references(() => mediaAssets.id, {
      onDelete: 'set null',
    }),
    status: projectStatus('status').notNull().default('draft'),
    version: integer('version').notNull().default(0), // lock otimista do rascunho
    publishedVersionId: uuid('published_version_id'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    check('slug_format', sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{1,79}$'`),
    uniqueIndex('project_slug_per_user')
      .on(t.userId, t.slug)
      .where(sql`deleted_at IS NULL`),
    // FK circular projects ⇄ project_versions. Sem ON DELETE: o DDL de referência
    // não define ação, então vale o padrão NO ACTION.
    foreignKey({
      name: 'projects_published_version_fk',
      columns: [t.publishedVersionId],
      foreignColumns: [projectVersions.id],
    }),
  ],
);

export const projectVersions = pgTable(
  'project_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Anotação explícita quebra o ciclo de inferência projects ⇄ project_versions.
    projectId: uuid('project_id')
      .notNull()
      .references((): AnyPgColumn => projects.id, { onDelete: 'cascade' }),
    versionNo: integer('version_no').notNull(),
    document: jsonb('document').$type<ProjectDocument>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('project_versions_project_id_version_no_key').on(t.projectId, t.versionNo)],
);
