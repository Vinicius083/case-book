import { CircleNotchIcon } from '@phosphor-icons/react/ssr';

import type { ReactNode } from 'react';

/** Tela inteira com conteúdo centralizado: carregamento e falha de sessão. */
export function FullScreen({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      {children}
    </main>
  );
}

export function LoadingScreen({ children }: { children: ReactNode }) {
  return (
    <FullScreen>
      <CircleNotchIcon aria-hidden className="size-6 animate-spin text-accent-text" />
      <p role="status" className="text-support text-muted">
        {children}
      </p>
    </FullScreen>
  );
}
