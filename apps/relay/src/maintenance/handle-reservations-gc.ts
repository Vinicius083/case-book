import { lt, sql } from 'drizzle-orm';

import { type Database, handleReservations } from '@casebook/db';

/** Reservas de handle vencidas (quarentena de 30 dias após uma troca). */
export async function gcHandleReservations(db: Database): Promise<number> {
  const rows = await db
    .delete(handleReservations)
    .where(lt(handleReservations.expiresAt, sql`now()`))
    .returning({ handle: handleReservations.handle });
  return rows.length;
}
