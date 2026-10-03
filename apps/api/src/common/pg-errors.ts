// Códigos de erro do Postgres (Apêndice A).
export const PG_UNIQUE_VIOLATION = '23505';
/** `lock_timeout` estourado esperando uma trava de linha. */
export const PG_LOCK_NOT_AVAILABLE = '55P03';
/** `statement_timeout` estourado (ou cancelamento). */
export const PG_QUERY_CANCELED = '57014';

interface PgError {
  code: string;
  constraint?: string;
}

/**
 * Extrai o erro do driver `pg` de dentro do erro do Drizzle, que o embrulha em
 * `cause`. Devolve `undefined` se não for um erro do Postgres.
 */
export function pgError(error: unknown): PgError | undefined {
  for (let current = error; current instanceof Error; current = current.cause) {
    const { code } = current as { code?: unknown };
    // SQLSTATE tem sempre 5 caracteres; erros do Node usam códigos como `ECONNREFUSED`.
    if (typeof code === 'string' && /^[\dA-Z]{5}$/.test(code)) return current as Error & PgError;
  }
  return undefined;
}
