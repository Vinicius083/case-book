import { cn } from '@/lib/utils';

import type { ComponentProps } from 'react';

const field =
  'w-full rounded-md border border-divider bg-surface px-3 text-base text-fg placeholder:text-muted/70 aria-invalid:border-danger disabled:cursor-not-allowed disabled:opacity-50';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(field, 'h-10', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(field, 'min-h-28 py-2 leading-relaxed', className)} {...props} />;
}
