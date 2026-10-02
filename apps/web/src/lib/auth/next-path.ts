export const DEFAULT_AFTER_LOGIN = '/app';

// Origem fictícia só para resolver o path; nunca aparece no resultado.
const BASE = 'http://casebook.internal';

/**
 * Valida o `?next=` do login: só rota interna do próprio site. Qualquer coisa que
 * um browser possa interpretar como outro host (`//evil.com`, `/\evil`,
 * `https://…`) cai no destino padrão — senão o login viraria um open redirect.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw?.startsWith('/')) return DEFAULT_AFTER_LOGIN;
  // `//host` e `/\host` são URLs relativas ao protocolo; caractere de controle
  // (tab, quebra de linha) é removido pelo parser de URL e pode formar um `//`.
  // eslint-disable-next-line no-control-regex
  if (raw.startsWith('//') || raw.includes('\\') || /[\u0000-\u001f\u007f]/.test(raw)) {
    return DEFAULT_AFTER_LOGIN;
  }

  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return DEFAULT_AFTER_LOGIN;
  }
  if (url.origin !== BASE) return DEFAULT_AFTER_LOGIN;
  // `/app/..//evil.com` só vira `//evil.com` depois de resolvido o `..`.
  if (url.pathname.startsWith('//')) return DEFAULT_AFTER_LOGIN;
  // Voltar para o login/cadastro depois de entrar não faz sentido; /api não é página.
  if (/^\/(login|signup|api)(\/|$)/.test(url.pathname)) return DEFAULT_AFTER_LOGIN;

  return `${url.pathname}${url.search}${url.hash}`;
}

/** URL do login que traz de volta para `path` depois de entrar. */
export function loginUrl(path: string): string {
  const next = safeNextPath(path);
  return next === DEFAULT_AFTER_LOGIN ? '/login' : `/login?next=${encodeURIComponent(next)}`;
}
