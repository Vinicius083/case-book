/**
 * Endereço público de um handle, a partir da URL base do site (`PUBLIC_BASE_URL`).
 * `text` é a forma que se mostra e se fala — sem protocolo; `url` é o link completo.
 */
export function publicAddress(baseUrl: string, handle: string): { text: string; url: string } {
  const base = baseUrl.replace(/\/+$/, '');
  return { text: `${base.replace(/^https?:\/\//, '')}/${handle}`, url: `${base}/${handle}` };
}
