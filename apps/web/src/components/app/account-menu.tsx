'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ExternalLink, LogOut, MonitorSmartphone, Settings } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Notice } from '@/components/ui/notice';
import { logout, logoutAll } from '@/lib/api/auth';
import { ApiError } from '@/lib/api/errors';
import { useMe } from '@/lib/hooks/use-me';

export function AccountMenu() {
  const { data } = useMe();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string>();

  const leave = async (action: () => Promise<void>) => {
    setError(undefined);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Não foi possível sair. Tente de novo.');
      return;
    }
    queryClient.clear();
    // Navegação completa: descarta todo o estado em memória da sessão que acabou.
    window.location.assign('/login');
  };

  const name = data?.me.profile.display_name ?? 'Conta';

  return (
    <div className="flex flex-col gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Conta de ${name}`}
          className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-raised"
        >
          <span
            aria-hidden
            className="font-heading flex size-9 shrink-0 items-center justify-center rounded-full bg-raised font-bold"
          >
            {name.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{name}</span>
            <span className="block truncate text-sm text-muted">
              {data ? `@${data.me.handle}` : ' '}
            </span>
          </span>
          <ChevronDown aria-hidden className="size-4 text-muted" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {data && <DropdownMenuLabel className="truncate">{data.me.email}</DropdownMenuLabel>}
          <DropdownMenuSeparator />
          {data && (
            <DropdownMenuItem asChild>
              <a href={`/u/${data.me.handle}`} target="_blank" rel="noreferrer">
                <ExternalLink aria-hidden /> Ver perfil público
              </a>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <Link href="/app/settings/profile">
              <Settings aria-hidden /> Configurações
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void leave(logout)}>
            <LogOut aria-hidden /> Sair
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void leave(logoutAll)}>
            <MonitorSmartphone aria-hidden /> Sair de todos os dispositivos
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {error && <Notice tone="danger">{error}</Notice>}
    </div>
  );
}
