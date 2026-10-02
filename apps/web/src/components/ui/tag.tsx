import { XIcon } from '@phosphor-icons/react/ssr';

import { cn } from '@/lib/utils';

import type { ReactNode } from 'react';

interface TagProps {
  children: ReactNode;
  /** Com `onRemove`, a tag ganha o botão de remover; `removeLabel` é o nome dele. */
  onRemove?: () => void;
  removeLabel?: string;
  className?: string;
}

/** Chip de texto curto (papel, especialidade). */
export function Tag({ children, onRemove, removeLabel, className }: TagProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md bg-accent-tint py-1.5 pl-3 text-[0.8125rem] text-on-accent-tint',
        onRemove ? 'pr-1' : 'pr-3',
        className,
      )}
    >
      {children}
      {onRemove && (
        <button
          type="button"
          aria-label={removeLabel}
          className="rounded-sm p-1 hover:bg-accent-tint"
          onClick={onRemove}
        >
          <XIcon aria-hidden className="size-3.5" />
        </button>
      )}
    </span>
  );
}
