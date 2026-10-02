import { z } from 'zod';

import { handleSchema } from './handle.js';
import { PASSWORD_MAX_LENGTH, passwordSchema } from './password.js';
import { displayNameSchema } from './profile.js';

export { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordSchema } from './password.js';

// Contratos de autenticação, compartilhados entre a API e o front. Importe por
// `@casebook/contracts/auth`: o entry principal carrega utilitários só de Node.

/** Email normalizado (trim + lowercase): a unicidade no banco é case-insensitive. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Email inválido').max(254, 'Email longo demais'));

export const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  handle: handleSchema,
  display_name: displayNameSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  // No login não se aplica a regra de tamanho mínimo (não revela a política); o
  // máximo limita o custo do argon2 com entrada arbitrária.
  password: z.string().min(1, 'Informe a senha').max(PASSWORD_MAX_LENGTH, 'Senha longa demais'),
});

/** Resposta de signup, login e refresh. O refresh token vai só no cookie. */
export const authTokenSchema = z.object({
  access_token: z.string(),
  token_type: z.literal('Bearer'),
  /** Validade do access token, em segundos. */
  expires_in: z.number().int().positive(),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type AuthToken = z.infer<typeof authTokenSchema>;
