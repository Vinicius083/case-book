'use client';

import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { bootstrapSession } from '@/lib/api/client';
import { clearSession, useSession } from '@/lib/api/session';
import { loginUrl } from '@/lib/auth/next-path';

import { FullScreen, LoadingScreen } from './full-screen';

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
      <FullScreen>
        <h1 className="text-section">Não deu para abrir sua sessão</h1>
        <p className="max-w-sm text-text-secondary">
          O servidor não respondeu. Sua sessão continua guardada; tente de novo em instantes.
        </p>
        <Button
          className="mt-2"
          onClick={() => {
            clearSession('unknown');
          }}
        >
          Tentar de novo
        </Button>
      </FullScreen>
    );
  }

  return <LoadingScreen>Abrindo sua sessão…</LoadingScreen>;
}
