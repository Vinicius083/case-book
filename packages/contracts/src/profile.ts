import { z } from 'zod';

import { handleSchema } from './handle.js';
import { PASSWORD_MAX_LENGTH, passwordSchema } from './password.js';

// Contratos de perfil, compartilhados entre a API e o front. Importe por
// `@casebook/contracts/profile`.

/** Mesmo limite do CHECK `profiles_bio_check`. */
export const BIO_MAX_LENGTH = 500;
/** Mesmo limite do CHECK `profiles_location_check`. */
export const LOCATION_MAX_LENGTH = 80;
export const PROFILE_LINKS_MAX = 8;
export const PROFILE_ROLES_MAX = 12;

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Informe o nome de exibição')
  .max(80, 'O nome de exibição pode ter no máximo 80 caracteres');

/** Texto puro: nada é interpretado como HTML, a renderização escapa. Vazio vira `null`. */
export const bioSchema = z
  .string()
  .trim()
  .max(BIO_MAX_LENGTH, `A bio pode ter no máximo ${String(BIO_MAX_LENGTH)} caracteres`)
  .transform((bio) => (bio === '' ? null : bio))
  .nullable();

/** Cidade/região em texto livre. Vazio vira `null`. */
export const locationSchema = z
  .string()
  .trim()
  .max(
    LOCATION_MAX_LENGTH,
    `A localização pode ter no máximo ${String(LOCATION_MAX_LENGTH)} caracteres`,
  )
  .transform((location) => (location === '' ? null : location))
  .nullable();

// `Intl.supportedValuesOf` lista só os nomes canônicos do ICU; `UTC` fica de fora
// em algumas versões e é uma escolha legítima.
const TIME_ZONES: ReadonlySet<string> = new Set([...Intl.supportedValuesOf('timeZone'), 'UTC']);

/** Timezones IANA oferecidos para `work_timezone`, em ordem alfabética. */
export function supportedTimeZones(): string[] {
  return [...TIME_ZONES].sort();
}

/**
 * Nome canônico é aceito direto; apelido IANA (`Asia/Kolkata` num runtime que
 * lista `Asia/Calcutta`) é aceito se resolver para um canônico — a lista do
 * browser que escolheu pode não ser a do servidor que valida.
 */
function isTimeZone(value: string): boolean {
  if (TIME_ZONES.has(value)) return true;
  try {
    const canonical = new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone;
    return value.includes('/') && TIME_ZONES.has(canonical);
  } catch {
    return false;
  }
}

/** Timezone IANA (`America/Sao_Paulo`). Vazio vira `null`. */
export const workTimezoneSchema = z
  .string()
  .trim()
  .transform((timezone) => (timezone === '' ? null : timezone))
  .nullable()
  .refine((timezone) => timezone === null || isTimeZone(timezone), 'Fuso horário inválido');

/** Só `https:` — `javascript:`, `data:` e `http:` não passam. */
const httpsUrlSchema = z
  .string()
  .trim()
  .max(2048, 'URL longa demais')
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname !== '';
    } catch {
      return false;
    }
  }, 'Use uma URL https://');

export const profileLinkSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, 'Informe o rótulo')
    .max(40, 'O rótulo pode ter no máximo 40 caracteres'),
  url: httpsUrlSchema,
});

const roleSchema = z
  .string()
  .trim()
  .min(1, 'Papel vazio')
  .max(40, 'Cada papel pode ter no máximo 40 caracteres');

export const rolesSchema = z
  .array(roleSchema)
  .max(PROFILE_ROLES_MAX, `No máximo ${String(PROFILE_ROLES_MAX)} papéis`)
  .refine((roles) => new Set(roles).size === roles.length, 'Papéis repetidos');

export const linksSchema = z
  .array(profileLinkSchema)
  .max(PROFILE_LINKS_MAX, `No máximo ${String(PROFILE_LINKS_MAX)} links`);

/** Edição parcial do perfil. Chave desconhecida é erro, não é ignorada. */
export const updateProfileSchema = z
  .strictObject({
    display_name: displayNameSchema,
    bio: bioSchema,
    location: locationSchema,
    work_timezone: workTimezoneSchema,
    available_for_freelance: z.boolean('Informe verdadeiro ou falso'),
    roles: rolesSchema,
    links: linksSchema,
    /**
     * Encerra o onboarding (passos de papel e perfil depois do cadastro), tanto ao
     * concluir quanto ao pular. Só aceita `true`: não há como reabrir.
     */
    onboarding_completed: z.literal(true, 'Só é possível marcar o onboarding como concluído'),
    /** Uma imagem da biblioteca do próprio usuário; `null` remove a foto. */
    avatar_media_id: z.uuid('Identificador de mídia inválido').nullable(),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Informe ao menos um campo');

export const changeHandleSchema = z.strictObject({ handle: handleSchema });

export const changePasswordSchema = z
  .strictObject({
    current_password: z
      .string()
      .min(1, 'Informe a senha atual')
      .max(PASSWORD_MAX_LENGTH, 'Senha longa demais'),
    new_password: passwordSchema,
  })
  .refine((body) => body.new_password !== body.current_password, {
    path: ['new_password'],
    message: 'A nova senha precisa ser diferente da atual',
  });

// ─── saída ───────────────────────────────────────────────────────────────────
// A API responde com `.parse` destes schemas: `z.object` descarta chave que não
// está declarada, então coluna sensível não vaza mesmo que a query traga a linha
// inteira.

const profileFields = {
  display_name: z.string(),
  bio: z.string().nullable(),
  location: z.string().nullable(),
  work_timezone: z.string().nullable(),
  available_for_freelance: z.boolean(),
  avatar_media_id: z.uuid().nullable(),
  /**
   * Menor derivativo WebP da foto (320px, ou a largura original se for menor);
   * `null` sem foto ou enquanto a imagem não está pronta.
   */
  avatar_url: z.url().nullable(),
  roles: z.array(z.string()),
  links: z.array(z.object({ label: z.string(), url: z.string() })),
  theme: z.record(z.string(), z.unknown()),
};

export const meResponseSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  email_verified: z.boolean(),
  handle: z.string(),
  created_at: z.iso.datetime(),
  /** Quando a próxima troca de handle é permitida; `null` se já pode trocar. */
  handle_change_allowed_at: z.iso.datetime().nullable(),
  profile: z.object({
    ...profileFields,
    /** `null` enquanto houver passo de onboarding pendente. */
    onboarding_completed_at: z.iso.datetime().nullable(),
    updated_at: z.iso.datetime(),
  }),
});

/** Perfil público: sem email, sem id interno do usuário. */
export const publicProfileResponseSchema = z.object({
  handle: z.string(),
  ...profileFields,
});

export type ProfileLinkInput = z.infer<typeof profileLinkSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangeHandleInput = z.infer<typeof changeHandleSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type PublicProfileResponse = z.infer<typeof publicProfileResponseSchema>;
