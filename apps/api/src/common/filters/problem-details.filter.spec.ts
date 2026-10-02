import { type ArgumentsHost, Logger, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { PROBLEM_CONTENT_TYPE } from '@casebook/contracts';

import { ZodValidationPipe } from '../pipes/zod-validation.pipe.js';
import { PROBLEM_TYPES, ProblemException } from '../problem.exception.js';

import { ProblemDetailsFilter } from './problem-details.filter.js';

function mockHost(url = '/some/path') {
  const reply = {
    status: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', url }),
      getResponse: () => reply,
    }),
  } as unknown as ArgumentsHost;
  return { host, reply };
}

function sentBody(reply: ReturnType<typeof mockHost>['reply']): Record<string, unknown> {
  return reply.send.mock.calls[0]?.[0] as Record<string, unknown>;
}

describe('ProblemDetailsFilter', () => {
  let filter: ProblemDetailsFilter;

  beforeEach(() => {
    filter = new ProblemDetailsFilter();
  });

  it('converte HttpException mantendo status e mensagem', () => {
    const { host, reply } = mockHost('/nao-existe');

    filter.catch(new NotFoundException('Projeto não encontrado'), host);

    expect(reply.status).toHaveBeenCalledWith(404);
    expect(reply.header).toHaveBeenCalledWith('content-type', PROBLEM_CONTENT_TYPE);
    expect(sentBody(reply)).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'Projeto não encontrado',
      instance: '/nao-existe',
      trace_id: expect.stringMatching(/^[\da-f]{32}$/) as unknown,
    });
  });

  it('converte falha do ZodValidationPipe em 422 com erros por campo em JSON Pointer', () => {
    const { host, reply } = mockHost();
    const pipe = new ZodValidationPipe(
      z.object({
        title: z.string().min(1),
        blocks: z.array(z.object({ rank: z.string() })),
      }),
    );

    let thrown: unknown;
    try {
      pipe.transform({ title: '', blocks: [{ rank: 1 }] });
    } catch (error) {
      thrown = error;
    }
    filter.catch(thrown, host);

    expect(reply.status).toHaveBeenCalledWith(422);
    const body = sentBody(reply);
    expect(body['type']).toBe(PROBLEM_TYPES.validation);
    expect(body['status']).toBe(422);
    expect(body['errors']).toEqual([
      { pointer: '/title', detail: expect.any(String) as unknown },
      { pointer: '/blocks/0/rank', detail: expect.any(String) as unknown },
    ]);
  });

  it('ZodError cru (fora do pipe) é erro interno: 500 sem detalhes de validação', () => {
    const { host, reply } = mockHost();
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const result = z.object({ title: z.string() }).safeParse({ title: 1 });
    if (result.success) throw new Error('schema deveria falhar');

    filter.catch(result.error, host);

    expect(reply.status).toHaveBeenCalledWith(500);
    expect(sentBody(reply)).not.toHaveProperty('errors');
  });

  it('ProblemException define type, title, errors e headers extras', () => {
    const { host, reply } = mockHost('/auth/login');

    filter.catch(
      new ProblemException({
        status: 429,
        type: PROBLEM_TYPES.rateLimited,
        title: 'Muitas tentativas',
        detail: 'Tente de novo em 30s.',
        headers: { 'retry-after': '30' },
      }),
      host,
    );

    expect(reply.status).toHaveBeenCalledWith(429);
    expect(reply.header).toHaveBeenCalledWith('retry-after', '30');
    expect(sentBody(reply)).toMatchObject({
      type: PROBLEM_TYPES.rateLimited,
      title: 'Muitas tentativas',
      status: 429,
      detail: 'Tente de novo em 30s.',
      instance: '/auth/login',
    });
  });

  it('converte erro desconhecido em 500 sem vazar mensagem nem stack', () => {
    const { host, reply } = mockHost();
    const logSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    filter.catch(new Error('senha do banco: hunter2'), host);

    expect(reply.status).toHaveBeenCalledWith(500);
    const body = sentBody(reply);
    expect(body).toMatchObject({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
    });
    expect(body).not.toHaveProperty('detail');
    expect(JSON.stringify(body)).not.toContain('hunter2');
    expect(logSpy).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('hunter2'));
  });
});
