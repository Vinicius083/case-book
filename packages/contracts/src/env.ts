import { z } from 'zod';

/**
 * Valida `process.env` contra o schema. Se algo estiver inválido, imprime a lista
 * de variáveis com problema e encerra o processo — um serviço mal configurado não
 * deve subir pela metade.
 */
export function parseEnv<T extends z.ZodType>(
  schema: T,
  env: NodeJS.ProcessEnv = process.env,
): z.infer<T> {
  const result = schema.safeParse(env);
  if (result.success) return result.data;

  console.error(formatEnvError(result.error, env));
  process.exit(1);
}

export function formatEnvError(error: z.ZodError, env: NodeJS.ProcessEnv = {}): string {
  const lines = error.issues.map((issue) => {
    const name = issue.path.join('.') || '(raiz)';
    const message = env[name] === undefined ? 'não definida' : issue.message;
    return `  - ${name}: ${message}`;
  });
  return ['Variáveis de ambiente inválidas:', ...lines].join('\n');
}

/** `"true"`/`"false"` → boolean. `z.coerce.boolean()` trata `"false"` como true. */
export const envBoolean = z.enum(['true', 'false']).transform((v) => v === 'true');
