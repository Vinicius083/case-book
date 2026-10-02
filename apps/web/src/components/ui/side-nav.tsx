import { ArrowUpRightIcon } from '@phosphor-icons/react/ssr';
import Link from 'next/link';

import { cn } from '@/lib/utils';

import type { Icon } from '@phosphor-icons/react';

export interface NavItem {
  href: string;
  label: string;
  icon: Icon;
  /** Abre em outra aba (ex.: o perfil público, que fica fora do app). */
  external?: boolean;
}

interface NavProps {
  label: string;
  items: readonly NavItem[];
  /** `href` do item da página atual. */
  current: string | undefined;
  className?: string;
}

/** Navegação lateral do app (desktop). */
export function SideNav({ label, items, current, className }: NavProps) {
  return (
    <nav aria-label={label} className={className}>
      <ul className="flex flex-col gap-[0.1875rem] text-[0.9375rem]">
        {items.map(({ href, label: text, icon: ItemIcon, external }) => {
          const active = href === current;
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                {...(external && { target: '_blank', rel: 'noreferrer' })}
                className={cn(
                  'flex items-center gap-[0.6875rem] rounded-md px-3 py-2.5',
                  active
                    ? 'bg-surface text-text'
                    : 'text-text-secondary hover:bg-surface hover:text-text',
                )}
              >
                <ItemIcon
                  aria-hidden
                  weight="duotone"
                  className={cn('size-[1.125rem] shrink-0', active && 'text-accent-text')}
                />
                <span className="min-w-0 flex-1 truncate">{text}</span>
                {external && (
                  <>
                    <ArrowUpRightIcon aria-hidden className="size-3.5 shrink-0 text-muted" />
                    <span className="sr-only">(abre em nova aba)</span>
                  </>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** A mesma navegação no celular: barra inferior só de ícones, com o nome para leitor de tela. */
export function BottomNav({ label, items, current, className }: NavProps) {
  return (
    <nav aria-label={label} className={className}>
      <ul className="flex justify-between">
        {items.map(({ href, label: text, icon: ItemIcon, external }) => {
          const active = href === current;
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                {...(external && { target: '_blank', rel: 'noreferrer' })}
                className={cn(
                  'flex size-12 items-center justify-center rounded-md',
                  active ? 'text-accent-text' : 'text-muted hover:text-text',
                )}
              >
                <ItemIcon aria-hidden weight="duotone" className="size-[1.375rem]" />
                <span className="sr-only">
                  {text}
                  {external && ' (abre em nova aba)'}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
