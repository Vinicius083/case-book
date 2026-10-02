import { cn } from '@/lib/utils';

import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** Tela sem conteúdo ainda: os três quadros vazios do design, o porquê e o próximo passo. */
export function EmptyState({ title, children, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-[1.375rem] px-6 py-16 text-center',
        className,
      )}
    >
      <div aria-hidden className="flex items-end gap-3.5 opacity-50">
        <span className="h-16 w-24 rounded-md border border-border-control" />
        <span className="size-24 rounded-md border border-border-control" />
        <span className="h-[3.25rem] w-24 rounded-md border border-border-control" />
      </div>
      <h2 className="mt-2 text-section">{title}</h2>
      <p className="max-w-[27.5rem] text-text-secondary">{children}</p>
      {action && <div className="mt-1.5">{action}</div>}
    </div>
  );
}
