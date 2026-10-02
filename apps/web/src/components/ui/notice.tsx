import { cn } from '@/lib/utils';

import type { ReactNode } from 'react';

interface NoticeProps {
  tone: 'danger' | 'success' | 'info';
  children: ReactNode;
  className?: string;
}

const tones = {
  danger: 'border-danger/50 text-danger',
  success: 'border-accent/50 text-accent',
  info: 'border-divider text-fg',
} as const;

/** Mensagem do formulário (erro da API, confirmação). Erro é anunciado na hora. */
export function Notice({ tone, children, className }: NoticeProps) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('rounded-md border bg-surface px-3 py-2.5 text-sm', tones[tone], className)}
    >
      {children}
    </div>
  );
}
