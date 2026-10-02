'use client';

import { cn } from '@/lib/utils';

import type { ComponentProps } from 'react';

interface SwitchProps extends Omit<ComponentProps<'button'>, 'onChange' | 'role' | 'type'> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

/** Liga/desliga. O nome vem de `aria-labelledby` ou de um `<label htmlFor>`. */
export function Switch({ checked, onCheckedChange, className, ...props }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={cn(
        'relative h-[1.625rem] w-[2.875rem] shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-45',
        checked ? 'border-accent bg-accent' : 'border-border-control bg-track',
        className,
      )}
      onClick={() => {
        onCheckedChange(!checked);
      }}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          'absolute top-0.5 left-0.5 size-5 rounded-full transition-transform',
          checked ? 'translate-x-5 bg-on-accent' : 'bg-text-secondary',
        )}
      />
    </button>
  );
}
