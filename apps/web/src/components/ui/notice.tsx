import { CheckCircleIcon, InfoIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr';

import { cn } from '@/lib/utils';

import type { ReactNode } from 'react';

interface NoticeProps {
  tone: 'danger' | 'success' | 'info';
  children: ReactNode;
  className?: string;
}

const tones = {
  danger: {
    box: 'border-danger-border bg-danger-tint',
    icon: 'text-danger',
    Icon: WarningCircleIcon,
  },
  success: { box: 'border-accent bg-accent-tint', icon: 'text-accent-text', Icon: CheckCircleIcon },
  info: { box: 'border-border bg-surface', icon: 'text-muted', Icon: InfoIcon },
} as const;

/** Mensagem do formulário (erro da API, confirmação). Erro é anunciado na hora. */
export function Notice({ tone, children, className }: NoticeProps) {
  const { box, icon, Icon } = tones[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-md border px-4 py-3 text-support text-text', box)}
    >
      <Icon aria-hidden weight="duotone" className={cn('mt-0.5 size-[1.125rem] shrink-0', icon)} />
      <div className={cn('min-w-0 flex-1', className)}>{children}</div>
    </div>
  );
}
