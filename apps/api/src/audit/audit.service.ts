import { Inject, Injectable } from '@nestjs/common';
import { trace } from '@opentelemetry/api';

import { auditLog, type Database, type DbExecutor } from '@casebook/db';

import { DB } from '../database/database.module.js';

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string | null;
  userId?: string | null;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Grava uma linha em `audit_log` com o `trace_id` da requisição. Passe a
   * transação em `executor` para o registro valer junto com a operação auditada.
   */
  async record(entry: AuditEntry, executor: DbExecutor = this.db): Promise<void> {
    await executor.insert(auditLog).values({
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      userId: entry.userId ?? null,
      metadata: entry.metadata ?? {},
      traceId: trace.getActiveSpan()?.spanContext().traceId ?? null,
    });
  }
}
