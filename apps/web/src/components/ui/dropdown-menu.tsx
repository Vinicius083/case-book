'use client';

import * as Menu from '@radix-ui/react-dropdown-menu';

import { cn } from '@/lib/utils';

import type { ComponentProps } from 'react';

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;

export function DropdownMenuContent({
  className,
  sideOffset = 8,
  ...props
}: ComponentProps<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-56 rounded-md border border-border bg-surface p-1 shadow-menu',
          className,
        )}
        {...props}
      />
    </Menu.Portal>
  );
}

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof Menu.Item>) {
  return (
    <Menu.Item
      className={cn(
        'flex cursor-default items-center gap-[0.6875rem] rounded-md px-3 py-2.5 text-[0.9375rem] text-text-secondary outline-none select-none data-[disabled]:opacity-45 data-[highlighted]:bg-raised data-[highlighted]:text-text [&_svg]:size-[1.125rem] [&_svg]:shrink-0',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof Menu.Label>) {
  return <Menu.Label className={cn('px-3 py-2 text-caption text-muted', className)} {...props} />;
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof Menu.Separator>) {
  return <Menu.Separator className={cn('my-1 h-px bg-border', className)} {...props} />;
}
