import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { handleProblem } from '@casebook/contracts/handle';

import nextConfig from '../../next.config';

const APP_DIR = fileURLToPath(new URL('.', import.meta.url));

/**
 * Primeiros segmentos de URL que o Next atende a partir de `app/`. Grupo de rotas
 * (`(auth)`) não vira segmento: desce um nível. Segmento dinâmico (`[handle]`) é
 * justamente o perfil público, não uma rota fixa. Pasta privada (`_x`) e rota
 * paralela (`@x`) não geram URL.
 */
function firstLevelSegments(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      if (/^\(.+\)$/.test(entry.name)) return firstLevelSegments(`${dir}/${entry.name}`);
      if (/^[[_@]/.test(entry.name)) return [];
      return [entry.name];
    });
}

describe('rotas de primeiro nível × handles', () => {
  // O perfil público mora em `/:handle`. Se alguém pudesse registrar o handle
  // `login`, a página de login passaria na frente e o perfil nunca abriria — ou,
  // pior, uma rota criada depois seria sequestrada por quem já tem o handle.
  it('nenhum segmento de primeiro nível de app/ pode ser registrado como handle', () => {
    const segments = firstLevelSegments(APP_DIR);
    expect(segments).toEqual(expect.arrayContaining(['app', 'login', 'signup', 'onboarding']));

    const registrable = segments.filter((segment) => handleProblem(segment) === undefined);
    expect(registrable, 'adicione em RESERVED_HANDLES (packages/contracts/src/handle.ts)').toEqual(
      [],
    );
  });

  it('prefixos de rewrite e redirect do next.config também são reservados', async () => {
    const sources = [
      ...((await nextConfig.rewrites?.()) as { source: string }[]),
      ...((await nextConfig.redirects?.()) ?? []),
    ].map(({ source }) => source.split('/')[1] ?? '');
    expect(sources).toEqual(expect.arrayContaining(['api', 'u']));

    expect(sources.filter((segment) => handleProblem(segment) === undefined)).toEqual([]);
  });
});
