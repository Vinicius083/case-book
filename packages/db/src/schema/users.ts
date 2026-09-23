import { sql } from 'drizzle-orm';
import { check, foreignKey, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Import circular (media → users → media) é seguro: o extra config só é avaliado
// depois que os dois módulos terminaram de carregar.
import { mediaAssets } from './media.js';
import { citext } from './types.js';

export interface ProfileLink {
  label: string;
  url: string;
}

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: citext('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    handle: citext('handle').notNull().unique(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [check('handle_format', sql`${t.handle} ~ '^[a-z0-9][a-z0-9-]{2,29}$'`)],
);

export const profiles = pgTable(
  'profiles',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    bio: text('bio'),
    avatarMediaId: uuid('avatar_media_id'),
    roles: text('roles')
      .array()
      .notNull()
      .default(sql`'{}'`),
    links: jsonb('links')
      .$type<ProfileLink[]>()
      .notNull()
      .default(sql`'[]'`),
    theme: jsonb('theme')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('profiles_bio_check', sql`length(${t.bio}) <= 500`),
    // FK "adiada" do DDL: media_assets depende de users, então no SQL de referência
    // ela é criada via ALTER TABLE depois das duas tabelas.
    foreignKey({
      name: 'profiles_avatar_fk',
      columns: [t.avatarMediaId],
      foreignColumns: [mediaAssets.id],
    }).onDelete('set null'),
  ],
);
