import { CircleNotchIcon } from '@phosphor-icons/react/ssr';
import { Slot, Slottable } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

import type { ComponentProps } from 'react';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md font-heading whitespace-nowrap transition-colors select-none disabled:cursor-not-allowed disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        /** Ação principal da tela: uma por vez. */
        primary: 'bg-accent font-semibold text-on-accent hover:bg-accent-hover',
        /** Ação de destaque que não é a principal ("Criar portfólio", "Publicar"). */
        outline: 'border border-accent-text text-accent-text hover:bg-accent-tint',
        secondary: 'border border-border-control text-text hover:bg-surface',
        ghost: 'text-text-secondary hover:bg-surface hover:text-text',
        danger: 'border border-danger-border bg-danger-tint text-danger hover:border-danger',
        /** Ação em texto, no meio de uma frase ou ao lado de um botão. */
        link: 'link rounded-sm font-sans',
      },
      size: {
        sm: 'h-9 px-4 text-support [&_svg]:size-4',
        md: 'h-11 px-6 text-[0.9375rem] [&_svg]:size-[1.0625rem]',
        lg: 'h-[3.25rem] px-8 text-body [&_svg]:size-[1.0625rem]',
        icon: 'size-10 [&_svg]:size-[1.125rem]',
        /** Sem caixa: para a variante `link`. */
        inline: '[&_svg]:size-4',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  /** Renderiza o filho (ex.: um `<Link>`) com a aparência de botão. */
  asChild?: boolean;
  /** Operação em curso: mostra o indicador e bloqueia o clique. O texto é o de quem chama. */
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      {...(!asChild && { type: props.type ?? 'button', disabled: disabled === true || loading })}
      {...(loading && { 'aria-busy': true })}
      {...props}
    >
      {loading && <CircleNotchIcon aria-hidden weight="bold" className="animate-spin" />}
      <Slottable>{children}</Slottable>
    </Comp>
  );
}
