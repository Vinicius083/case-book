import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// O tailwind-merge não lê o @theme: sem isto ele trata `text-body` (tamanho) e
// `text-on-accent` (cor) como a mesma coisa e joga um dos dois fora.
// Manter igual aos `--text-*` de globals.css.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['caption', 'support', 'body', 'card', 'section', 'page', 'screen'] }],
    },
  },
});

/** Junta classes condicionais e resolve conflitos de utilitários do Tailwind. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
