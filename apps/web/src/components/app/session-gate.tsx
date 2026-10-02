'use client';

import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { bootstrapSession } from '@/lib/api/client';
import { clearSession, useSession } from '@/lib/api/session';
import { loginUrl } from '@/lib/auth/next-path';

/**
 * Só renderiza a área logada depois de haver access token em memória. Enquanto o
 * bootstrap (cookie → token) roda, mostra um estado de carregamento — nada do
 * conteúdo protegido chega a ser montado, então não há flash.
 */
export function SessionGate({ children }: { children: ReactNode }) {
  const status = useSession((state) => state.status);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'unknown') void bootstrapSession();
    if (status === 'anonymous') router.replace(loginUrl(pathname));
  }, [status, router, pathname]);

  if (status === 'authenticated') return children;

  if (status === 'unavailable') {
    return (
      <Centered>
        <p className="font-heading text-xl font-bold">Não deu para abrir sua sessão</p>
        <p className="max-w-sm text-muted">
          O servidor não respondeu. Sua sessão continua guardada; tente de novo em instantes.
        </p>
        <Button
          onClick={() => {
            clearSession('unknown');
          }}
        >
          Tentar de novo
        </Button>
      </Centered>
    );
  }

  return (
    <Centered>
      <span
        aria-hidden
        className="size-6 animate-spin rounded-full border-2 border-divider border-t-accent"
      />
      <p role="status" className="text-muted">
        Abrindo sua sessão…
      </p>
    </Centered>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      {children}
    </div>
  );
}
