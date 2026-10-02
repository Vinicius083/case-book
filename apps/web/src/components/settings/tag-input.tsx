'use client';

import { type KeyboardEvent, useState } from 'react';

import { Input } from '@/components/ui/input';
import { Tag } from '@/components/ui/tag';

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
            <li key={tag}>
              <Tag
                removeLabel={`Remover ${tag}`}
                onRemove={() => {
                  onChange(value.filter((other) => other !== tag));
                }}
              >
                {tag}
              </Tag>
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
