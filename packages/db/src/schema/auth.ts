import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  index,
  inet,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { bytea } from './types.js';
import { users } from './users.js';

export const REFRESH_TOKEN_REVOKED_REASONS = [
  'logout',
  'reuse_detected',
  'password_change',
  'expired',
] as const;

export type RefreshTokenRevokedReason = (typeof REFRESH_TOKEN_REVOKED_REASONS)[number];

// Uma linha por refresh token emitido. O token em si nunca é gravado, só o SHA-256.
// `family_id` agrupa a cadeia de rotações de um mesmo login: reuso de um token já
// rotacionado revoga a família inteira.
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => refreshTokens.id, {
      onDelete: 'set null',
    }),
    tokenHash: bytea('token_hash').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason').$type<RefreshTokenRevokedReason>(),
    userAgent: text('user_agent'),
    ip: inet('ip'),
  },
  (t) => [
    check(
      'refresh_tokens_revoked_reason_check',
      sql`${t.revokedReason} IN ('logout', 'reuse_detected', 'password_change', 'expired')`,
    ),
    index('refresh_tokens_by_family').on(t.familyId),
    index('refresh_tokens_active_by_user')
      .on(t.userId)
      .where(sql`${t.revokedAt} IS NULL`),
  ],
);
