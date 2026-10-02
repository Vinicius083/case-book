import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

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
  (t) => [
    // `::text` é obrigatório: sobre citext o operador `~` é case-insensitive e o
    // CHECK aceitaria maiúsculas. O unique case-insensitive continua vindo do citext.
    check('handle_format', sql`${t.handle}::text ~ '^[a-z0-9][a-z0-9-]{2,29}$'`),
  ],
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
    location: text('location'),
    // Timezone IANA (`America/Sao_Paulo`); a lista válida muda com o tzdata, então
    // a validação fica no contrato (Zod), não em CHECK.
    workTimezone: text('work_timezone'),
    availableForFreelance: boolean('available_for_freelance').notNull().default(false),
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
    // Nulo enquanto a pessoa não terminou (ou pulou) os passos de papel e perfil
    // que vêm depois do cadastro; o app manda para o passo pendente.
    onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('profiles_bio_check', sql`length(${t.bio}) <= 500`),
    check('profiles_location_check', sql`char_length(${t.location}) <= 80`),
    // FK "adiada" do DDL: media_assets depende de users, então no SQL de referência
    // ela é criada via ALTER TABLE depois das duas tabelas.
    foreignKey({
      name: 'profiles_avatar_fk',
      columns: [t.avatarMediaId],
      foreignColumns: [mediaAssets.id],
    }).onDelete('set null'),
  ],
);

// Quarentena de handle: ao trocar de handle, o antigo fica reservado ao dono até
// `expires_at`. Sem isso, outra pessoa registraria o handle recém-liberado e se
// passaria pelo dono anterior nos links já compartilhados. Linhas expiradas são
// ignoradas nas consultas.
export const handleReservations = pgTable(
  'handle_reservations',
  {
    handle: citext('handle').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    releasedAt: timestamp('released_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    // Mesma regra (e mesmo cast) do `handle_format` de `users`.
    check(
      'handle_reservations_handle_format',
      sql`${t.handle}::text ~ '^[a-z0-9][a-z0-9-]{2,29}$'`,
    ),
  ],
);
