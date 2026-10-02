import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// Contraste WCAG 2.1 AA dos tokens de cor, nos dois temas, lido direto do
// globals.css: trocar um valor por outro que não passa quebra o teste, não a tela.

const css = readFileSync(fileURLToPath(new URL('./globals.css', import.meta.url)), 'utf8');

type Rgba = [number, number, number, number];
type Tokens = Record<string, string>;

/** Declarações `--color-*` do primeiro bloco que começa em `opening`. */
function block(opening: string): Tokens {
  const start = css.indexOf(opening);
  if (start === -1) throw new Error(`bloco não encontrado: ${opening}`);
  // Os blocos de cor não têm chaves aninhadas antes do fim das declarações de cor.
  const body = css.slice(start + opening.length, css.indexOf('}', start));
  return Object.fromEntries(
    [...body.matchAll(/--color-([a-z0-9-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2]]),
  ) as Tokens;
}

function parse(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value)?.[1];
  if (hex) {
    const n = Number.parseInt(hex, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgb = /^rgb\((\d+) (\d+) (\d+)(?: \/ ([\d.]+))?\)$/.exec(value);
  if (!rgb) throw new Error(`cor em formato inesperado: ${value}`);
  return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), Number(rgb[4] ?? 1)];
}

/** Cor (possivelmente translúcida) pintada sobre um fundo opaco. */
function over([r, g, b, a]: Rgba, [br, bg, bb]: Rgba): Rgba {
  return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a), 1];
}

function luminance([r, g, b]: Rgba): number {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const dark = block('@theme {');
const light = { ...dark, ...block(":root[data-theme='light'] {") };
const lightFromSystem = { ...dark, ...block(':root:not([data-theme]) {') };

/** [frente, fundo, fundo sob o fundo (quando o fundo é translúcido)] */
type Pair = [fg: string, bg: string, under?: string];

// Texto normal: 4,5:1.
const TEXT: Pair[] = [
  ...['text', 'text-secondary', 'muted', 'subtle', 'accent-text', 'danger'].flatMap(
    (fg): Pair[] => [
      [fg, 'bg'],
      [fg, 'surface'],
    ],
  ),
  ['text', 'raised'],
  ['text-secondary', 'raised'],
  ['text', 'well'],
  ['muted', 'well'],
  ['on-accent', 'accent'],
  ['on-accent', 'accent-hover'],
  ['on-accent-tint', 'accent-tint', 'bg'],
  ['on-accent-tint', 'accent-tint', 'surface'],
  ['accent-text', 'accent-tint', 'bg'],
  ['text', 'danger-tint', 'bg'],
  ['danger', 'danger-tint', 'bg'],
  ['danger', 'danger-tint', 'surface'],
  ['content-text', 'content-bg'],
  ['content-text-secondary', 'content-bg'],
  ['content-muted', 'content-bg'],
  ['content-accent-text', 'content-bg'],
  ['content-accent-text', 'content-accent-tint', 'content-bg'],
  ['content-on-accent', 'content-accent'],
];

// Componente de interface e indicador de foco: 3:1 (critério 1.4.11).
const UI: Pair[] = [
  ['border-control', 'bg'],
  ['border-control', 'surface'],
  ['accent', 'bg'],
  ['accent', 'surface'],
  ['accent-text', 'bg'],
  ['accent-text', 'surface'],
  ['danger', 'bg'],
  ['danger', 'surface'],
  ['text-secondary', 'track'],
  ['on-accent', 'accent'],
];

function ratio(tokens: Tokens, [fg, bg, under]: Pair): number {
  const color = (name: string) => {
    const value = tokens[name];
    if (!value) throw new Error(`token inexistente: --color-${name}`);
    return parse(value);
  };
  const background = under ? over(color(bg), color(under)) : color(bg);
  return contrast(over(color(fg), background), background);
}

describe.each([
  ['escuro', dark],
  ['claro', light],
])('contraste do tema %s', (_, tokens) => {
  it.each(TEXT)('texto %s sobre %s %s ≥ 4,5:1', (...pair) => {
    expect(ratio(tokens, pair)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(UI)('interface %s sobre %s %s ≥ 3:1', (...pair) => {
    expect(ratio(tokens, pair)).toBeGreaterThanOrEqual(3);
  });
});

describe('tema claro', () => {
  it('é o mesmo por escolha explícita e por prefers-color-scheme', () => {
    expect(lightFromSystem).toEqual(light);
  });
});
