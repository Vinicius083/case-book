import { type ArgumentsHost, Logger, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { PROBLEM_CONTENT_TYPE } from '@casebook/contracts';

import { PROBLEM_TYPES, ProblemDetailsFilter } from './problem-details.filter.js';

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

  it('converte ZodError em 422 com erros por campo em JSON Pointer', () => {
    const { host, reply } = mockHost();
    const schema = z.object({
      title: z.string().min(1),
      blocks: z.array(z.object({ rank: z.string() })),
    });
    const result = schema.safeParse({ title: '', blocks: [{ rank: 1 }] });
    if (result.success) throw new Error('schema deveria falhar');

    filter.catch(result.error, host);

    expect(reply.status).toHaveBeenCalledWith(422);
    const body = sentBody(reply);
    expect(body['type']).toBe(PROBLEM_TYPES.validation);
    expect(body['status']).toBe(422);
    expect(body['errors']).toEqual([
      { pointer: '/title', detail: expect.any(String) as unknown },
      { pointer: '/blocks/0/rank', detail: expect.any(String) as unknown },
    ]);
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
