import { type Problem, PROBLEM_CONTENT_TYPE, problemSchema } from '@casebook/contracts/problem';

/**
 * Erro de qualquer chamada à API, montado a partir do Problem Details (RFC 9457).
 * `status` 0 significa que não houve resposta (rede fora, API fora).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly type: string;
  readonly traceId: string | undefined;
  /** Erros por campo, com a chave no formato de path do react-hook-form (`links.0.url`). */
  readonly fieldErrors: Readonly<Record<string, string>>;
  /** Do header `Retry-After`, presente nos 429. */
  readonly retryAfterSec: number | undefined;

  constructor(init: {
    status: number;
    message: string;
    type?: string;
    traceId?: string | undefined;
    fieldErrors?: Record<string, string>;
    retryAfterSec?: number | undefined;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.type = init.type ?? 'about:blank';
    this.traceId = init.traceId;
    this.fieldErrors = init.fieldErrors ?? {};
    this.retryAfterSec = init.retryAfterSec;
  }

  static network(): ApiError {
    return new ApiError({
      status: 0,
      message: 'Não foi possível falar com o servidor. Confira sua conexão e tente de novo.',
    });
  }

  static async fromResponse(response: Response): Promise<ApiError> {
    const retryAfter = Number(response.headers.get('retry-after'));
    const retryAfterSec = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined;
    const problem = await readProblem(response);

    return new ApiError({
      status: response.status,
      message: messageFor(response.status, problem, retryAfterSec),
      traceId: problem?.trace_id,
      retryAfterSec,
      ...(problem && { type: problem.type }),
      fieldErrors: Object.fromEntries(
        (problem?.errors ?? []).map((error) => [pointerToPath(error.pointer), error.detail]),
      ),
    });
  }
}

async function readProblem(response: Response): Promise<Problem | undefined> {
  if (!response.headers.get('content-type')?.includes(PROBLEM_CONTENT_TYPE)) return undefined;
  const parsed = problemSchema.safeParse(await response.json().catch(() => undefined));
  return parsed.success ? parsed.data : undefined;
}

function messageFor(status: number, problem: Problem | undefined, retryAfterSec?: number): string {
  if (status === 429) {
    return retryAfterSec
      ? `Muitas tentativas. Tente de novo em ${formatWait(retryAfterSec)}.`
      : 'Muitas tentativas. Aguarde um pouco e tente de novo.';
  }
  if (status >= 500) return 'O servidor falhou ao atender o pedido. Tente de novo em instantes.';
  return problem?.detail ?? problem?.title ?? `A requisição falhou (HTTP ${String(status)}).`;
}

/** JSON Pointer (`/links/0/url`) → path de formulário (`links.0.url`). */
export function pointerToPath(pointer: string): string {
  return pointer
    .split('/')
    .slice(1)
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
    .join('.');
}

/** Espera em linguagem de gente: "45 segundos", "12 minutos", "1 hora". */
export function formatWait(seconds: number): string {
  const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;
  if (seconds < 60) return plural(Math.ceil(seconds), 'segundo', 'segundos');
  if (seconds < 3600) return plural(Math.ceil(seconds / 60), 'minuto', 'minutos');
  return plural(Math.ceil(seconds / 3600), 'hora', 'horas');
}
