'use client';

import { EyeIcon, EyeSlashIcon } from '@phosphor-icons/react/ssr';
import { useState } from 'react';

import { cn } from '@/lib/utils';

import type { ComponentProps } from 'react';

/** Caixa de controle de texto: a mesma para input, textarea e o gatilho do combobox. */
export const controlClass =
  'w-full rounded-md border border-border-control bg-surface px-[0.9375rem] text-body text-text transition-[border-color,box-shadow] placeholder:text-subtle focus-visible:border-accent-text focus-visible:shadow-[0_0_0_3px_var(--color-focus-ring)] focus-visible:outline-none aria-invalid:border-danger disabled:cursor-not-allowed disabled:opacity-50';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(controlClass, 'h-12', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea className={cn(controlClass, 'min-h-32 py-3 leading-normal', className)} {...props} />
  );
}

interface PasswordInputProps extends Omit<ComponentProps<'input'>, 'type'> {
  /** Nome do botão de mostrar/ocultar quando há mais de um campo de senha na tela. */
  revealLabel?: string;
  hideLabel?: string;
}

/** Campo de senha com o botão de mostrar/ocultar do design. */
export function PasswordInput({
  className,
  revealLabel = 'Mostrar senha',
  hideLabel = 'Ocultar senha',
  ...props
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeSlashIcon : EyeIcon;

  return (
    <div className="relative">
      <Input type={visible ? 'text' : 'password'} className={cn('pr-12', className)} {...props} />
      <button
        type="button"
        aria-label={visible ? hideLabel : revealLabel}
        disabled={props.disabled}
        className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-md text-muted hover:text-text disabled:opacity-50"
        onClick={() => {
          setVisible((current) => !current);
        }}
      >
        <Icon aria-hidden weight="duotone" className="size-[1.125rem]" />
      </button>
    </div>
  );
}
