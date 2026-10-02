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

/**
 * Regex do CHECK `handle_format` em vigor: a última definição nas migrations, em
 * ordem de aplicação.
 *
 * Por que parsear as migrations em vez de comparar com uma constante usada no
 * schema Drizzle: o que o Postgres aplica é o SQL das migrations. Uma constante
 * compartilhada continuaria "concordando" se alguém mudasse a regex sem gerar a
 * migration — exatamente o desvio que este teste existe para pegar.
 */
function handleCheckInDatabase(): string {
  const definitions = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .flatMap((file) => {
      const sql = readFileSync(`${MIGRATIONS_DIR}/${file}`, 'utf8');
      return [...sql.matchAll(/CONSTRAINT "handle_format" CHECK \((.+?) ~ '([^']+)'\)/g)];
    });

  const current = definitions.at(-1);
  if (!current?.[1] || !current[2]) throw new Error('CHECK handle_format não encontrado');
  // Sem o cast, `~` sobre citext é case-insensitive e o banco aceitaria maiúsculas.
  expect(current[1]).toBe('"users"."handle"::text');
  return current[2];
}

describe('handle', () => {
  it('a regex do Zod é idêntica à do CHECK handle_format do banco', () => {
    expect(HANDLE_PATTERN.source).toBe(handleCheckInDatabase());
    expect(HANDLE_PATTERN.flags).toBe(''); // sem `i`: o CHECK é case-sensitive
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
