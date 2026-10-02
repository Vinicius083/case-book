import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema> & { $client: pg.Pool };

/** Handle da transação aberta por `db.transaction(async (tx) => …)`. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Aceita o pool ou uma transação em andamento. */
export type DbExecutor = Database | Transaction;

export interface CreateDbOptions {
  /** Tamanho máximo do pool. Padrão: 20. */
  max?: number;
}

/** Cria o client Drizzle com pool próprio. Quem cria é responsável por `db.$client.end()`. */
export function createDb(url: string, options: CreateDbOptions = {}): Database {
  const pool = new pg.Pool({ connectionString: url, max: options.max ?? 20 });
  return drizzle(pool, { schema });
}
