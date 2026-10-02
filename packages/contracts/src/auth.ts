import { z } from 'zod';

// Contratos de autenticação, compartilhados entre a API e o front. Importe por
// `@casebook/contracts/auth`: o entry principal carrega utilitários só de Node.

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/** Email normalizado (trim + lowercase): a unicidade no banco é case-insensitive. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Email inválido').max(254, 'Email longo demais'));

/** Senha nova (cadastro). Sem trim: espaços fazem parte da senha. */
export const passwordSchema = z
  .string()
  .min(
    PASSWORD_MIN_LENGTH,
    `A senha precisa ter ao menos ${String(PASSWORD_MIN_LENGTH)} caracteres`,
  )
  .max(PASSWORD_MAX_LENGTH, `A senha pode ter no máximo ${String(PASSWORD_MAX_LENGTH)} caracteres`);

/** Mesma regra do CHECK `handle_format` em `users`. */
export const HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{2,29}$/;

/**
 * Handle público (`/u/:handle`), normalizado para minúsculas. Aqui só o formato;
 * a lista de reservados entra na parte de perfil, estendendo este schema.
 */
export const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(
    z
      .string()
      .regex(
        HANDLE_PATTERN,
        'Use de 3 a 30 caracteres: letras minúsculas, números e hífen, sem começar por hífen',
      ),
  );

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Informe o nome de exibição')
  .max(80, 'O nome de exibição pode ter no máximo 80 caracteres');

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
