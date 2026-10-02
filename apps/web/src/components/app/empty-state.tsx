import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, children, action }: EmptyStateProps) {
  return (
    <div className="flex max-w-xl flex-col items-start gap-4 border border-dashed border-divider p-8">
      <Icon aria-hidden className="size-7 text-muted" />
      <h2 className="font-heading text-xl font-bold">{title}</h2>
      <p className="leading-relaxed text-muted">{children}</p>
      {action}
    </div>
  );
}
