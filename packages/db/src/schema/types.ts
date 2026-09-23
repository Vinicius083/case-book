import { customType } from 'drizzle-orm/pg-core';

/** `citext` (extensão) — comparação case-insensitive para email, handle e slug. */
export const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});

/** `bytea` — o Drizzle não tem tipo nativo para bytea. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});
