'use client';

import {
  GearSixIcon,
  ImagesIcon,
  SquaresFourIcon,
  UserCircleIcon,
} from '@phosphor-icons/react/ssr';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';

import { MediaEvents } from '@/components/media/media-events';
import { BottomNav, type NavItem, SideNav } from '@/components/ui/side-nav';
import { useMe } from '@/lib/hooks/use-me';
import { pendingOnboardingStep } from '@/lib/onboarding';

import { AccountMenu } from './account-menu';
import { ConnectionIndicator } from './connection-indicator';
import { LoadingScreen } from './full-screen';

const SETTINGS = '/app/settings/profile';

function navItems(handle: string | undefined): NavItem[] {
  return [
    { href: '/app', label: 'Projetos', icon: SquaresFourIcon },
    { href: '/app/media', label: 'Biblioteca de mídia', icon: ImagesIcon },
    ...(handle
      ? [{ href: `/${handle}`, label: 'Perfil público', icon: UserCircleIcon, external: true }]
      : []),
    { href: SETTINGS, label: 'Configurações', icon: GearSixIcon },
  ];
}

function currentItem(pathname: string): string | undefined {
  if (pathname === '/app') return '/app';
  if (pathname.startsWith('/app/media')) return '/app/media';
  if (pathname.startsWith('/app/settings')) return SETTINGS;
  return undefined;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const me = useMe();

  // Quem ainda não passou pelos passos de papel e perfil volta para o que falta.
  const pendingStep = me.data && pendingOnboardingStep(me.data.me);
  useEffect(() => {
    if (pendingStep) router.replace(pendingStep);
  }, [pendingStep, router]);

  if (me.isPending || pendingStep) return <LoadingScreen>Abrindo o Casebook…</LoadingScreen>;

  const items = navItems(me.data?.me.handle);
  const current = currentItem(pathname);

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[14.75rem_minmax(0,1fr)]">
      <MediaEvents />
      <aside className="sticky top-0 hidden h-dvh flex-col gap-[1.875rem] border-r border-border px-[1.375rem] py-[1.625rem] md:flex">
        <Link href="/app" className="brand-mark w-fit rounded-sm">
          Casebook
        </Link>
        <SideNav label="Principal" items={items} current={current} />
        <div className="-mx-2 mt-auto flex flex-col gap-3">
          <ConnectionIndicator className="px-2" />
          <AccountMenu />
        </div>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-col pb-[4.25rem] md:pb-0">
        <div className="flex items-center justify-between border-b border-border py-2 pr-3.5 pl-5 md:hidden">
          <Link href="/app" className="brand-mark rounded-sm">
            Casebook
          </Link>
          <div className="flex items-center gap-3">
            <ConnectionIndicator />
            <AccountMenu compact />
          </div>
        </div>
        <main className="flex flex-1 flex-col">{children}</main>
      </div>

      <BottomNav
        label="Principal"
        items={items}
        current={current}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg px-6 py-2 md:hidden"
      />
    </div>
  );
}
