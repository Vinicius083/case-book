import { z } from 'zod';

/** Media type de respostas de erro (RFC 9457). */
export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

export const problemFieldErrorSchema = z.object({
  /** Caminho do campo, em JSON Pointer (RFC 6901), ex.: `/blocks/0/props/title`. */
  pointer: z.string(),
  detail: z.string(),
});

/** Problem Details (RFC 9457) com as extensões do Casebook. */
export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
  /** Extensão: trace OTel da requisição, para correlacionar com o SigNoz. */
  trace_id: z.string(),
  /** Extensão: erros de validação por campo (422). */
  errors: z.array(problemFieldErrorSchema).optional(),
});

export type ProblemFieldError = z.infer<typeof problemFieldErrorSchema>;
export type Problem = z.infer<typeof problemSchema>;

/** Converte um path do Zod em JSON Pointer. */
export function toJsonPointer(path: readonly PropertyKey[]): string {
  if (path.length === 0) return '';
  return '/' + path.map((seg) => String(seg).replaceAll('~', '~0').replaceAll('/', '~1')).join('/');
}

export function zodIssuesToFieldErrors(error: z.ZodError): ProblemFieldError[] {
  return error.issues.map((issue) => ({
    pointer: toJsonPointer(issue.path),
    detail: issue.message,
  }));
}
