'use client';

import { Clapperboard, Images, UserRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

import { AccountMenu } from './account-menu';

import type { ReactNode } from 'react';

const NAV = [
  { href: '/app', label: 'Projetos', icon: Clapperboard, exact: true },
  { href: '/app/media', label: 'Biblioteca de mídia', icon: Images, exact: false },
  { href: '/app/settings/profile', label: 'Perfil', icon: UserRound, exact: false },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[16rem_1fr]">
      <aside className="flex flex-col gap-6 border-b border-divider p-4 md:sticky md:top-0 md:h-dvh md:border-r md:border-b-0">
        <Link href="/app" className="font-heading px-2 text-lg font-bold">
          Casebook
        </Link>

        <nav aria-label="Principal">
          <ul className="flex gap-1 overflow-x-auto md:flex-col">
            {NAV.map(({ href, label, icon: Icon, exact }) => {
              const active = exact ? pathname === href : pathname.startsWith(href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-3 rounded-md px-2 py-2 text-sm whitespace-nowrap text-muted hover:bg-raised hover:text-fg',
                      active && 'bg-raised font-semibold text-fg',
                    )}
                  >
                    <Icon aria-hidden className={cn('size-4', active && 'text-accent')} />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="md:mt-auto">
          <AccountMenu />
        </div>
      </aside>

      <main className="px-6 py-10 sm:px-10">{children}</main>
    </div>
  );
}
