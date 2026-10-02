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

/** Edição parcial do perfil. Chave desconhecida é erro, não é ignorada. */
export const updateProfileSchema = z
  .strictObject({
    display_name: displayNameSchema,
    bio: bioSchema,
    location: locationSchema,
    roles: z
      .array(roleSchema)
      .max(PROFILE_ROLES_MAX, `No máximo ${String(PROFILE_ROLES_MAX)} papéis`)
      .refine((roles) => new Set(roles).size === roles.length, 'Papéis repetidos'),
    links: z
      .array(profileLinkSchema)
      .max(PROFILE_LINKS_MAX, `No máximo ${String(PROFILE_LINKS_MAX)} links`),
    /** Só a referência; o upload do avatar entra com o pipeline de mídia. */
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
  avatar_media_id: z.uuid().nullable(),
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
  profile: z.object({ ...profileFields, updated_at: z.iso.datetime() }),
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
