'use client';

import { DesktopIcon, MoonIcon, SunIcon } from '@phosphor-icons/react/ssr';
import { useEffect, useState } from 'react';

import { Segmented } from '@/components/ui/segmented';
import { applyThemeChoice, currentThemeChoice, type ThemeChoice } from '@/lib/theme';

const OPTIONS = [
  { value: 'system', label: 'Sistema', icon: <DesktopIcon aria-hidden weight="duotone" /> },
  { value: 'light', label: 'Claro', icon: <SunIcon aria-hidden weight="duotone" /> },
  { value: 'dark', label: 'Escuro', icon: <MoonIcon aria-hidden weight="duotone" /> },
] as const;

/** Tema da interface do app. Vale neste navegador; a página pública não muda com ele. */
export function ThemeToggle() {
  // A escolha mora no `<html data-theme>`, que só existe no browser: lida depois de montar.
  const [choice, setChoice] = useState<ThemeChoice>('system');
  useEffect(() => {
    setChoice(currentThemeChoice());
  }, []);

  return (
    <Segmented
      name="theme"
      legend="Tema"
      options={OPTIONS}
      value={choice}
      onChange={(next) => {
        applyThemeChoice(next);
        setChoice(next);
      }}
    />
  );
}
