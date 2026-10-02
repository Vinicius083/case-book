'use client';

import { X } from 'lucide-react';
import { type KeyboardEvent, useState } from 'react';

import { Input } from '@/components/ui/input';

interface TagInputProps {
  id: string;
  value: string[];
  onChange: (value: string[]) => void;
  max: number;
  placeholder?: string;
  'aria-invalid'?: true | undefined;
  'aria-describedby'?: string;
}

/** Lista de textos curtos: Enter ou vírgula adiciona, Backspace no campo vazio remove o último. */
export function TagInput({ id, value, onChange, max, placeholder, ...aria }: TagInputProps) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const tag = draft.trim();
    if (tag !== '' && !value.includes(tag) && value.length < max) onChange([...value, tag]);
    setDraft('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add();
    } else if (event.key === 'Backspace' && draft === '') {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {value.map((tag) => (
            <li
              key={tag}
              className="flex items-center gap-1 rounded-full border border-divider bg-surface py-1 pr-1 pl-3 text-sm"
            >
              {tag}
              <button
                type="button"
                aria-label={`Remover ${tag}`}
                className="rounded-full p-1 text-muted hover:bg-raised hover:text-fg"
                onClick={() => {
                  onChange(value.filter((other) => other !== tag));
                }}
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Input
        id={id}
        value={draft}
        placeholder={placeholder}
        disabled={value.length >= max}
        maxLength={40}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onKeyDown={onKeyDown}
        onBlur={add}
        {...aria}
      />
    </div>
  );
}
