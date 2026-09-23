import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { mediaAssets } from './media.js';
import { projects } from './projects.js';

export const blockType = pgEnum('block_type', [
  'cover',
  'text',
  'image',
  'gallery_grid',
  'fullbleed',
  'split',
  'carousel',
  'video',
  'spacer',
]);

/** Props do bloco. Union discriminada por tipo entra na Sprint 3. */
export type BlockProps = Record<string, unknown>;

/** Recorte normalizado 0..1. */
export interface BlockMediaCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const blocks = pgTable(
  'blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    type: blockType('type').notNull(),
    rank: text('rank').notNull(), // LexoRank; ordenação por (rank, id)
    props: jsonb('props')
      .$type<BlockProps>()
      .notNull()
      .default(sql`'{}'`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('blocks_ordered').on(t.projectId, t.rank)],
);

export const blockMedia = pgTable(
  'block_media',
  {
    blockId: uuid('block_id')
      .notNull()
      .references(() => blocks.id, { onDelete: 'cascade' }),
    // RESTRICT intencional: deletar mídia em uso deve falhar no banco; a aplicação
    // faz soft delete (RF-LIB-3) em vez de cascatear e furar um bloco.
    mediaId: uuid('media_id')
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'restrict' }),
    role: text('role').notNull().default('primary'),
    position: integer('position').notNull().default(0),
    crop: jsonb('crop').$type<BlockMediaCrop>(),
  },
  (t) => [
    primaryKey({
      name: 'block_media_pkey',
      columns: [t.blockId, t.mediaId, t.role, t.position],
    }),
    index('block_media_by_media').on(t.mediaId),
  ],
);
