import { describe, expect, it } from 'vitest';

import { DEFAULT_AFTER_LOGIN, loginUrl, safeNextPath } from './next-path';

describe('safeNextPath', () => {
  it.each([
    ['/app', '/app'],
    ['/app/settings/profile', '/app/settings/profile'],
    ['/app/media?tipo=video#topo', '/app/media?tipo=video#topo'],
    ['/app/../app/media', '/app/media'],
  ])('aceita rota interna: %s', (raw, expected) => {
    expect(safeNextPath(raw)).toBe(expected);
  });

  it.each([
    '//evil.com',
    '//evil.com/app',
    'https://evil.com',
    'https://evil.com/app',
    'http://localhost:3000/app',
    '/\\evil',
    '/app/..//evil.com',
    '/..//evil.com',
    '/\\/evil.com',
    '\\\\evil.com',
    '/\t/evil.com',
    '/\n/evil.com',
    'javascript:alert(1)',
    'app',
    'evil.com',
    ' /app',
    '',
  ])('rejeita o que pode sair do site: %j', (raw) => {
    expect(safeNextPath(raw)).toBe(DEFAULT_AFTER_LOGIN);
  });

  it('sem valor, cai no destino padrão', () => {
    expect(safeNextPath(null)).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNextPath(undefined)).toBe(DEFAULT_AFTER_LOGIN);
  });

  it.each(['/login', '/login?next=/app', '/signup', '/api/auth/logout'])(
    'não volta para login, cadastro nem API: %s',
    (raw) => {
      expect(safeNextPath(raw)).toBe(DEFAULT_AFTER_LOGIN);
    },
  );

  it('o resultado nunca é interpretado como outro host', () => {
    for (const raw of ['//evil.com', '/\\evil', '/app', '/app/..//evil.com']) {
      expect(new URL(safeNextPath(raw), 'https://casebook.app').origin).toBe(
        'https://casebook.app',
      );
    }
  });
});

describe('loginUrl', () => {
  it('codifica a rota de volta em ?next=', () => {
    expect(loginUrl('/app/settings/profile?aba=1')).toBe(
      '/login?next=%2Fapp%2Fsettings%2Fprofile%3Faba%3D1',
    );
  });

  it('omite ?next= quando o destino é o padrão ou é inválido', () => {
    expect(loginUrl('/app')).toBe('/login');
    expect(loginUrl('//evil.com')).toBe('/login');
  });
});
