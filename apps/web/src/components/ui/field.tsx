import { WarningCircleIcon } from '@phosphor-icons/react/ssr';

import { cn } from '@/lib/utils';

import { Label } from './label';

import type { ReactNode } from 'react';

interface FieldProps {
  /** `id` do controle; os ids de dica e erro derivam dele (ver `fieldAria`). */
  id: string;
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
  /** À direita do rótulo (ex.: contador de caracteres). */
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Rótulo + controle + dica + erro, com as ligações de acessibilidade. */
export function Field({ id, label, error, hint, aside, className, children }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-[0.4375rem]', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        {aside}
      </div>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-support text-muted">
          {hint}
        </p>
      )}
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );
}

/** Mensagem de erro de um campo. Anunciada na hora em que aparece. */
export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="flex items-start gap-1.5 text-support text-danger">
      <WarningCircleIcon aria-hidden weight="duotone" className="mt-[0.1875rem] size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** Atributos ARIA do controle dentro de um `Field`. */
export function fieldAria(id: string, error: string | undefined, hasHint = false) {
  const describedBy = error ? `${id}-error` : hasHint ? `${id}-hint` : undefined;
  return {
    id,
    'aria-invalid': error ? true : undefined,
    ...(describedBy && { 'aria-describedby': describedBy }),
  } as const;
}
