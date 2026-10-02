'use client';

import { CaretDownIcon, CheckIcon } from '@phosphor-icons/react/ssr';
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

import { controlClass } from './input';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Texto de apoio à direita (ex.: o deslocamento do fuso). */
  detail?: string;
}

interface ComboboxProps {
  id: string;
  options: readonly ComboboxOption[];
  /** `''` é "nada escolhido". */
  value: string;
  onChange: (value: string) => void;
  /** Nome da opção que limpa a escolha. */
  emptyLabel: string;
  placeholder?: string;
  'aria-invalid'?: true | undefined;
  'aria-describedby'?: string;
}

// Sem acento e sem caixa: "sao paulo" encontra "São Paulo".
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/**
 * Select com busca (padrão combobox do ARIA): digitar filtra, setas percorrem,
 * Enter escolhe, Esc desiste. Sair do campo sem escolher mantém o valor anterior.
 */
export function Combobox({
  id,
  options,
  value,
  onChange,
  emptyLabel,
  placeholder,
  ...aria
}: ComboboxProps) {
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const all = useMemo(() => [{ value: '', label: emptyLabel }, ...options], [options, emptyLabel]);
  const selected = options.find((option) => option.value === value);
  const matches = useMemo(() => {
    const needle = fold(query.trim());
    if (needle === '') return all;
    return all.filter((option) =>
      fold(`${option.label} ${option.value} ${option.detail ?? ''}`).includes(needle),
    );
  }, [all, query]);

  useEffect(() => {
    if (open) listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const show = () => {
    setQuery('');
    setActive(
      Math.max(
        0,
        all.findIndex((option) => option.value === value),
      ),
    );
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setQuery('');
  };
  const choose = (option: ComboboxOption | undefined) => {
    if (option) onChange(option.value);
    close();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        show();
        return;
      }
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((index) => Math.min(matches.length - 1, Math.max(0, index + step)));
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      choose(matches[active]);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      close();
    }
  };

  return (
    <div className="relative">
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${String(active)}` : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        className={cn(controlClass, 'h-12 pr-10')}
        value={open ? query : (selected?.label ?? '')}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onClick={() => {
          if (!open) show();
        }}
        onKeyDown={onKeyDown}
        onBlur={close}
        {...aria}
      />
      <CaretDownIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-[0.9375rem] size-[0.9375rem] -translate-y-1/2 text-muted"
      />
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        hidden={!open}
        className="absolute inset-x-0 top-full z-40 mt-1 max-h-64 overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-menu"
      >
        {matches.length === 0 && (
          <li role="presentation" className="px-3 py-2.5 text-support text-muted">
            Nada encontrado.
          </li>
        )}
        {matches.map((option, index) => (
          <li
            key={option.value}
            id={`${listId}-${String(index)}`}
            role="option"
            aria-selected={option.value === value}
            className={cn(
              'flex cursor-default items-center gap-3 rounded-md px-3 py-2 text-[0.9375rem] text-text-secondary',
              index === active && 'bg-raised text-text',
            )}
            // mousedown, não click: o blur do input fecharia a lista antes do click.
            onMouseDown={(event) => {
              event.preventDefault();
              choose(option);
            }}
            onMouseEnter={() => {
              setActive(index);
            }}
          >
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            {option.detail && <span className="text-caption text-muted">{option.detail}</span>}
            {option.value === value && (
              <CheckIcon aria-hidden className="size-3.5 shrink-0 text-accent-text" />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
