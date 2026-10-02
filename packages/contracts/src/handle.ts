import { z } from 'zod';

// Regras de handle (`/:handle`), compartilhadas entre a API e o front. Importe
// por `@casebook/contracts/handle`.

/**
 * Formato do handle. Precisa ser idêntico à regex dos CHECKs de handle no banco
 * (`users` e `handle_reservations`) — `handle.test.ts` compara este source com o
 * das migrations.
 */
export const HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{2,29}$/;

/**
 * Handles que colidem com rotas, subdomínios ou nomes que sugerem conta oficial.
 * O perfil público mora em `/:handle`, então todo segmento de primeiro nível do
 * site precisa estar aqui — `apps/web/src/app/routes.test.ts` percorre as rotas
 * do Next e falha se alguma faltar.
 */
export const RESERVED_HANDLES = [
  'api',
  'admin',
  'app',
  'u',
  'ui',
  'onboarding',
  'dev',
  'public',
  'health',
  'robots',
  'sitemap',
  'favicon',
  'pricing',
  'precos',
  'blog',
  'docs',
  'contact',
  'contato',
  'legal',
  'security',
  'billing',
  'account',
  'dashboard',
  'projects',
  'p',
  'auth',
  'login',
  'signup',
  'logout',
  'settings',
  'me',
  'help',
  'about',
  'terms',
  'privacy',
  'explore',
  'discover',
  'search',
  'new',
  'edit',
  'static',
  'assets',
  'cdn',
  'media',
  'casebook',
  'root',
  'support',
  'status',
  'www',
] as const;

const reserved: ReadonlySet<string> = new Set(RESERVED_HANDLES);

export function normalizeHandle(raw: string): string {
  return raw.trim().toLowerCase();
}

export type HandleProblem = 'reserved' | 'invalid';

/**
 * Valida um handle já normalizado. "Reservado" é checado antes do formato para
 * `me` ou `u` (curtos demais) serem reportados como reservados, não como inválidos.
 */
export function handleProblem(handle: string): HandleProblem | undefined {
  if (reserved.has(handle)) return 'reserved';
  if (!HANDLE_PATTERN.test(handle)) return 'invalid';
  return undefined;
}

const MESSAGES: Record<HandleProblem, string> = {
  reserved: 'Este handle é reservado',
  invalid: 'Use de 3 a 30 caracteres: letras minúsculas, números e hífen, sem começar por hífen',
};

/** Handle normalizado (trim + lowercase), no formato do banco e fora da lista de reservados. */
export const handleSchema = z
  .string()
  .transform(normalizeHandle)
  .superRefine((handle, ctx) => {
    const problem = handleProblem(handle);
    if (problem) ctx.addIssue({ code: 'custom', message: MESSAGES[problem] });
  });

export const handleAvailabilitySchema = z.object({
  available: z.boolean(),
  reason: z.enum(['taken', 'reserved', 'invalid']).optional(),
});

export type HandleAvailability = z.infer<typeof handleAvailabilitySchema>;
