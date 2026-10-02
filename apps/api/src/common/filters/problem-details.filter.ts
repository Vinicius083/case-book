import { STATUS_CODES } from 'node:http';

import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { INVALID_TRACEID, trace } from '@opentelemetry/api';

import { type Problem, PROBLEM_CONTENT_TYPE } from '@casebook/contracts';

import { ProblemException } from '../problem.exception.js';

import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Converte qualquer exceção em Problem Details (RFC 9457), sempre com `trace_id`
 * para correlacionar a resposta com o trace no SigNoz.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    const problem = this.toProblem(exception, request.url);

    if (problem.status >= 500) {
      // Detalhe completo só no log (e no span, via instrumentação); nunca na resposta.
      this.logger.error(
        `${request.method} ${request.url} → ${String(problem.status)} [trace_id=${problem.trace_id}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    if (exception instanceof ProblemException) {
      for (const [name, value] of Object.entries(exception.problem.headers ?? {})) {
        void reply.header(name, value);
      }
    }

    void reply.status(problem.status).header('content-type', PROBLEM_CONTENT_TYPE).send(problem);
  }

  toProblem(exception: unknown, instance: string): Problem {
    const trace_id = currentTraceId();

    if (exception instanceof ProblemException) {
      const { status, type, title, detail, errors } = exception.problem;
      return {
        type: type ?? 'about:blank',
        title: title ?? STATUS_CODES[status] ?? 'Error',
        status,
        ...(detail !== undefined && { detail }),
        instance,
        trace_id,
        ...(errors !== undefined && { errors }),
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        type: 'about:blank',
        title: STATUS_CODES[status] ?? 'Error',
        status,
        detail: httpExceptionDetail(exception),
        instance,
        trace_id,
      };
    }

    // Inclui `ZodError` cru: validação de requisição passa pelo ZodValidationPipe
    // (422); um ZodError que chega aqui é dado interno inválido, ou seja, bug nosso.
    return {
      type: 'about:blank',
      title: STATUS_CODES[HttpStatus.INTERNAL_SERVER_ERROR] ?? 'Internal Server Error',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      instance,
      trace_id,
    };
  }
}

function currentTraceId(): string {
  return trace.getActiveSpan()?.spanContext().traceId ?? INVALID_TRACEID;
}

function httpExceptionDetail(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === 'string') return response;
  const message = (response as { message?: unknown }).message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.map(String).join('; ');
  return exception.message;
}
