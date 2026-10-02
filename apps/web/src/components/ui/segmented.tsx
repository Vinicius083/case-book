'use client';

import { cn } from '@/lib/utils';

import type { ReactNode } from 'react';

interface SegmentedProps<T extends string> {
  /** Nome do grupo de rádio; também o prefixo dos ids. */
  name: string;
  legend: string;
  options: readonly { value: T; label: string; icon?: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
}

/** Escolha única entre poucas opções, lado a lado. Por baixo, um grupo de rádio. */
export function Segmented<T extends string>({
  name,
  legend,
  options,
  value,
  onChange,
}: SegmentedProps<T>) {
  return (
    <fieldset>
      <legend className="sr-only">{legend}</legend>
      <div className="inline-flex rounded-md border border-border-control p-0.5">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              'relative flex items-center gap-2 rounded-sm px-4 py-2 text-support has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent-text',
              option.value === value
                ? 'bg-accent-tint text-on-accent-tint'
                : 'text-muted hover:text-text',
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              // Cobre o rótulo inteiro, invisível: o clique e o foco são do próprio rádio.
              className="absolute inset-0 cursor-pointer opacity-0"
              onChange={() => {
                onChange(option.value);
              }}
            />
            {option.icon}
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
