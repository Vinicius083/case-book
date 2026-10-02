import { ApiError } from './api/errors';

import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';

/**
 * Leva um erro da API para o formulário: erro de campo vai para o campo (e o
 * primeiro ganha o foco); o que sobrar volta como mensagem geral do formulário.
 * `fields` são os campos de primeiro nível que o formulário tem.
 */
export function applyApiError<TValues extends FieldValues>(
  // O tipo de saída do resolver não importa aqui.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: UseFormReturn<TValues, any, any>,
  error: unknown,
  fields: readonly (keyof TValues & string)[],
): string | undefined {
  if (!(error instanceof ApiError)) return 'Algo deu errado. Tente de novo.';

  const matched = Object.entries(error.fieldErrors).filter(([path]) =>
    fields.includes(path.split('.')[0] ?? ''),
  );
  for (const [path, message] of matched) {
    form.setError(path as Path<TValues>, { type: 'server', message });
  }
  const first = matched[0]?.[0];
  if (!first) return error.message;

  form.setFocus(first as Path<TValues>);
  return undefined;
}
