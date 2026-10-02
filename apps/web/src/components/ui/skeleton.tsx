import { cn } from '@/lib/utils';

import type { ComponentProps } from 'react';

/**
 * Placeholder de conteúdo carregando. Decorativo: quem usa anuncia o carregamento
 * em texto (`role="status"`), uma vez, para o grupo inteiro.
 */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-shimmer rounded-md bg-[linear-gradient(90deg,var(--color-surface)_25%,var(--color-raised)_50%,var(--color-surface)_75%)] bg-[length:200%_100%]',
        className,
      )}
      {...props}
    />
  );
}
