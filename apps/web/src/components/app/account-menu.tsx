'use client';

import {
  ArrowSquareOutIcon,
  CaretUpDownIcon,
  DevicesIcon,
  GearSixIcon,
  SignOutIcon,
} from '@phosphor-icons/react/ssr';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';

import { Avatar } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/toast';
import { logout, logoutAll } from '@/lib/api/auth';
import { ApiError } from '@/lib/api/errors';
import { useMe } from '@/lib/hooks/use-me';
import { cn } from '@/lib/utils';

/** Encerra a sessão e sai para o login; se a API recusar, avisa e fica onde está. */
export function useLeave() {
  const queryClient = useQueryClient();
  return async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (cause) {
      toast(
        cause instanceof ApiError ? cause.message : 'Não foi possível sair. Tente de novo.',
        'danger',
      );
      return;
    }
    queryClient.clear();
    // Navegação completa: descarta todo o estado em memória da sessão que acabou.
    window.location.assign('/login');
  };
}

/** `compact`: só o avatar (barra do topo no celular). */
export function AccountMenu({ compact = false }: { compact?: boolean }) {
  const { data } = useMe();
  const leave = useLeave();
  const name = data?.me.profile.display_name ?? 'Conta';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Conta de ${name}`}
        className={cn(
          'flex items-center gap-2.5 rounded-md text-left text-support hover:bg-surface',
          compact ? 'p-1.5' : 'w-full p-2',
        )}
      >
        <Avatar name={name} src={data?.me.profile.avatar_url} />
        {!compact && (
          <>
            <span className="min-w-0 flex-1 truncate">{name}</span>
            <CaretUpDownIcon aria-hidden className="size-3.5 shrink-0 text-muted" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={compact ? 'end' : 'start'} className="w-64">
        {data && <DropdownMenuLabel className="truncate">{data.me.email}</DropdownMenuLabel>}
        <DropdownMenuSeparator />
        {data && (
          <DropdownMenuItem asChild>
            <a href={`/${data.me.handle}`} target="_blank" rel="noreferrer">
              <ArrowSquareOutIcon aria-hidden weight="duotone" /> Ver perfil público
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link href="/app/settings/profile">
            <GearSixIcon aria-hidden weight="duotone" /> Configurações
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void leave(logout)}>
          <SignOutIcon aria-hidden weight="duotone" /> Sair
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void leave(logoutAll)}>
          <DevicesIcon aria-hidden weight="duotone" /> Sair de todos os dispositivos
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
