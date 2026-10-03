import { STATUS_CODES } from 'node:http';

import { HttpException } from '@nestjs/common';

import type { ProblemFieldError } from '@casebook/contracts';
import { MEDIA_PROBLEM_TYPES } from '@casebook/contracts/media';

/** `type` dos problemas próprios do Casebook. HTTP genérico usa `about:blank` (RFC 9457 §4.2.1). */
export const PROBLEM_TYPES = {
  validation: 'urn:casebook:problem:validation',
  conflict: 'urn:casebook:problem:conflict',
  rateLimited: 'urn:casebook:problem:rate-limited',
  handleChangeTooSoon: 'urn:casebook:problem:handle-change-too-soon',
  serviceUnavailable: 'urn:casebook:problem:service-unavailable',
  ...MEDIA_PROBLEM_TYPES,
} as const;

export interface ProblemInit {
  status: number;
  /** Padrão: `about:blank`. */
  type?: string;
  /** Padrão: a reason phrase do status. */
  title?: string;
  detail?: string;
  errors?: ProblemFieldError[];
  /** Membros de extensão no corpo (RFC 9457 §3.2), ex.: `requires_confirmation`. */
  extensions?: Record<string, unknown>;
  /** Headers extras da resposta (ex.: `Retry-After`, `WWW-Authenticate`). */
  headers?: Record<string, string>;
}

/** Exceção que já carrega os campos de Problem Details; o filtro só serializa. */
export class ProblemException extends HttpException {
  constructor(readonly problem: ProblemInit) {
    super(
      problem.detail ?? problem.title ?? STATUS_CODES[problem.status] ?? 'Error',
      problem.status,
    );
  }
}
