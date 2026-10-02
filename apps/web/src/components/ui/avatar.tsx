import { cn } from '@/lib/utils';

interface AvatarProps {
  name: string;
  className?: string;
}

/**
 * Avatar sem foto: círculo com a inicial. Decorativo — o nome sempre aparece em
 * texto ao lado. A foto entra com a biblioteca de mídia.
 */
export function Avatar({ name, className }: AvatarProps) {
  return (
    <span
      aria-hidden
      className={cn(
        'bg-placeholder flex size-[1.875rem] shrink-0 items-center justify-center rounded-full font-heading text-[0.8125rem] font-semibold text-content-text',
        className,
      )}
    >
      {name.trim().slice(0, 1).toUpperCase()}
    </span>
  );
}
