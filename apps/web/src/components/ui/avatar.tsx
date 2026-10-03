import { cn } from '@/lib/utils';

interface AvatarProps {
  name: string;
  /** URL da foto (derivativo pequeno). Sem ela, a inicial. */
  src?: string | null | undefined;
  className?: string;
}

/**
 * Avatar: a foto de perfil ou, sem ela, um círculo com a inicial. Decorativo — o
 * nome sempre aparece em texto ao lado.
 */
export function Avatar({ name, src, className }: AvatarProps) {
  return (
    <span
      aria-hidden
      className={cn(
        'bg-placeholder flex size-[1.875rem] shrink-0 items-center justify-center overflow-hidden rounded-full font-heading text-[0.8125rem] font-semibold text-content-text',
        className,
      )}
    >
      {src ? (
        // Derivativo já otimizado pelo worker, servido direto do storage.
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        name.trim().slice(0, 1).toUpperCase()
      )}
    </span>
  );
}
