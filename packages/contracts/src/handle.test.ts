import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  HANDLE_PATTERN,
  handleProblem,
  handleSchema,
  normalizeHandle,
  RESERVED_HANDLES,
} from './handle.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../db/migrations', import.meta.url));

// Todo CHECK de formato de handle no banco: constraint → coluna (com o cast).
const HANDLE_CHECKS = {
  handle_format: '"users"."handle"::text',
  handle_reservations_handle_format: '"handle_reservations"."handle"::text',
};

/**
 * Regex do CHECK em vigor: a última definição da constraint nas migrations, em
 * ordem de aplicação.
 *
 * Por que parsear as migrations em vez de comparar com uma constante usada no
 * schema Drizzle: o que o Postgres aplica é o SQL das migrations. Uma constante
 * compartilhada continuaria "concordando" se alguém mudasse a regex sem gerar a
 * migration — exatamente o desvio que este teste existe para pegar.
 */
function checkInDatabase(constraint: string): { column: string; pattern: string } {
  const definition = new RegExp(`CONSTRAINT "${constraint}" CHECK \\((.+?) ~ '([^']+)'\\)`, 'g');
  const definitions = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .flatMap((file) => [...readFileSync(`${MIGRATIONS_DIR}/${file}`, 'utf8').matchAll(definition)]);

  const current = definitions.at(-1);
  if (!current?.[1] || !current[2]) throw new Error(`CHECK ${constraint} não encontrado`);
  return { column: current[1], pattern: current[2] };
}

/** Qualquer CHECK das migrations que valide uma coluna `handle` por regex. */
function handleCheckNames(): string[] {
  const names = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .flatMap((file) => [
      ...readFileSync(`${MIGRATIONS_DIR}/${file}`, 'utf8').matchAll(
        /CONSTRAINT "([^"]+)" CHECK \("[^"]+"\."handle"[^~]* ~ /g,
      ),
    ])
    .map((match) => match[1] ?? '');
  return [...new Set(names)].sort();
}

describe('handle', () => {
  it.each(Object.entries(HANDLE_CHECKS))(
    'a regex do Zod é idêntica à do CHECK %s do banco',
    (constraint, column) => {
      const check = checkInDatabase(constraint);
      expect(check.pattern).toBe(HANDLE_PATTERN.source);
      // Sem o cast, `~` sobre citext é case-insensitive e o banco aceitaria maiúsculas.
      expect(check.column).toBe(column);
    },
  );

  it('a regex não tem flags: o CHECK é case-sensitive', () => {
    expect(HANDLE_PATTERN.flags).toBe('');
  });

  it('nenhum CHECK de handle das migrations fica fora deste teste', () => {
    expect(handleCheckNames()).toEqual(Object.keys(HANDLE_CHECKS).sort());
  });

  it.each(RESERVED_HANDLES)('reservado falha: %s', (handle) => {
    expect(handleSchema.safeParse(handle).success).toBe(false);
    expect(handleSchema.safeParse(` ${handle.toUpperCase()} `).success).toBe(false);
    expect(handleProblem(handle)).toBe('reserved');
  });

  it('a lista de reservados não tem repetidos e já está normalizada', () => {
    expect(new Set(RESERVED_HANDLES).size).toBe(RESERVED_HANDLES.length);
    for (const handle of RESERVED_HANDLES) expect(normalizeHandle(handle)).toBe(handle);
  });

  it('normaliza com trim + lowercase antes de validar', () => {
    expect(handleSchema.parse('  Ana-Lima ')).toBe('ana-lima');
  });

  it.each(['ab', '-ana', 'ana_lima', 'ana lima', 'aná', 'a'.repeat(31), ''])(
    'formato inválido: %j',
    (handle) => {
      expect(handleSchema.safeParse(handle).success).toBe(false);
      expect(handleProblem(handle)).toBe('invalid');
    },
  );

  it.each(['ana', 'a-b', '3d-artist', 'a'.repeat(30), 'administrator'])('válido: %s', (handle) => {
    expect(handleSchema.parse(handle)).toBe(handle);
  });
});
