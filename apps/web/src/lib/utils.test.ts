import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { cn } from './utils';

const css = readFileSync(fileURLToPath(new URL('../app/globals.css', import.meta.url)), 'utf8');

describe('cn', () => {
  it('o último utilitário do mesmo grupo vence', () => {
    expect(cn('px-2 text-muted', 'px-4')).toBe('text-muted px-4');
  });

  // Todo tamanho de texto declarado no @theme precisa estar no grupo `font-size`
  // do tailwind-merge; senão `cn` o confunde com cor e descarta um dos dois.
  it('tamanho de texto do tema não derruba a cor (nem o contrário)', () => {
    const sizes = [...css.matchAll(/^\s*--text-([a-z]+):/gm)].map((match) => match[1]);
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) {
      expect(cn(`text-${String(size)}`, 'text-on-accent')).toBe(
        `text-${String(size)} text-on-accent`,
      );
      expect(cn(`text-${String(size)}`, 'text-body')).toBe('text-body');
    }
  });
});
