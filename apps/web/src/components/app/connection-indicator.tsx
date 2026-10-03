'use client';

import { CircleNotchIcon, WifiSlashIcon } from '@phosphor-icons/react/ssr';
import { useEffect, useState } from 'react';

import { type ConnectionStatus, useConnectionStatus } from '@/lib/media/events';
import { cn } from '@/lib/utils';

/** Uma queda mais curta que isto não aparece: reconexão de rotina não é notícia. */
const SHOW_AFTER_MS = 2_000;

const MESSAGES: Partial<Record<ConnectionStatus, string>> = {
  reconnecting: 'Reconectando…',
  offline: 'Sem conexão com a API',
};

/**
 * Estado da conexão com a API no app shell. Calado enquanto está tudo bem; avisa
 * quando a conexão de eventos cai (reconectando) e quando várias tentativas
 * falham (sem conexão). É o aviso global que faltava quando a API cai no meio do uso.
 */
export function ConnectionIndicator({ className }: { className?: string }) {
  const status = useConnectionStatus();
  const [visible, setVisible] = useState<ConnectionStatus>('connected');

  useEffect(() => {
    if (status === 'connected' || status === 'connecting') {
      setVisible(status);
      return;
    }
    const timer = setTimeout(() => {
      setVisible(status);
    }, SHOW_AFTER_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [status]);

  const message = MESSAGES[visible];
  return (
    <p
      role="status"
      aria-live="polite"
      data-connection={status}
      className={cn(
        'flex items-center gap-2 text-caption',
        visible === 'offline' ? 'text-danger' : 'text-muted',
        !message && 'sr-only',
        className,
      )}
    >
      {visible === 'offline' && (
        <WifiSlashIcon aria-hidden weight="duotone" className="size-4 shrink-0" />
      )}
      {visible === 'reconnecting' && (
        <CircleNotchIcon aria-hidden className="size-4 shrink-0 animate-pulse-soft" />
      )}
      {message ?? 'Conectado'}
    </p>
  );
}
