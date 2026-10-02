/** `system` = sem escolha: vale o `prefers-color-scheme`, e escuro se o sistema não disser nada. */
export type ThemeChoice = 'system' | 'light' | 'dark';

/**
 * Cookie, e não localStorage: o servidor lê e já manda o `<html data-theme>`
 * certo, sem piscar o tema errado nem script inline. Só existe depois que a
 * pessoa escolhe; "sistema" o apaga.
 */
export const THEME_COOKIE = 'cb_theme';

export function parseTheme(value: string | undefined): 'light' | 'dark' | undefined {
  return value === 'light' || value === 'dark' ? value : undefined;
}

export function currentThemeChoice(): ThemeChoice {
  return parseTheme(document.documentElement.dataset['theme']) ?? 'system';
}

export function applyThemeChoice(choice: ThemeChoice): void {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  if (choice === 'system') {
    delete document.documentElement.dataset['theme'];
    document.cookie = `${THEME_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
  } else {
    document.documentElement.dataset['theme'] = choice;
    document.cookie = `${THEME_COOKIE}=${choice}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  }
}
