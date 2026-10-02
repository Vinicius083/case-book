import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/** Senha nova (cadastro e troca). Sem trim: espaços fazem parte da senha. */
export const passwordSchema = z
  .string()
  .min(
    PASSWORD_MIN_LENGTH,
    `A senha precisa ter ao menos ${String(PASSWORD_MIN_LENGTH)} caracteres`,
  )
  .max(PASSWORD_MAX_LENGTH, `A senha pode ter no máximo ${String(PASSWORD_MAX_LENGTH)} caracteres`);
