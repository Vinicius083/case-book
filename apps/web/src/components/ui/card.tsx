import { cn } from '@/lib/utils';

import type { ComponentProps } from 'react';

/** Caixa de superfície: agrupa um bloco de conteúdo ou um controle com descrição. */
export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('rounded-md border border-border bg-surface p-[1.125rem]', className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: ComponentProps<'h3'>) {
  return <h3 className={cn('text-card font-normal', className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('mt-0.5 text-caption text-muted', className)} {...props} />;
}
