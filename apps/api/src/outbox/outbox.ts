import { sql } from 'drizzle-orm';

import { type MediaUploadedEvent, OUTBOX_CHANNEL, type OutboxEventType } from '@casebook/contracts';
import { outboxEvents, type Transaction } from '@casebook/db';

interface OutboxEventInput {
  aggregate: 'media_asset';
  aggregateId: string;
  eventType: OutboxEventType;
  payload: MediaUploadedEvent;
}

/**
 * Grava o evento na transação do agregado e avisa o relay (ADR-4). O `NOTIFY`
 * só é entregue no commit; se a transação desfizer, nem o evento nem o aviso
 * existem. O relay tem poll de fallback, então um aviso perdido só atrasa.
 */
export async function appendOutboxEvent(tx: Transaction, event: OutboxEventInput): Promise<number> {
  const [row] = await tx
    .insert(outboxEvents)
    .values({
      aggregate: event.aggregate,
      aggregateId: event.aggregateId,
      eventType: event.eventType,
      payload: event.payload,
      traceId: event.payload.traceparent.split('-')[1] ?? null,
    })
    .returning({ id: outboxEvents.id });
  if (!row) throw new Error('INSERT em outbox_events sem RETURNING');
  await tx.execute(sql`SELECT pg_notify(${OUTBOX_CHANNEL}, ${String(row.id)})`);
  return row.id;
}
