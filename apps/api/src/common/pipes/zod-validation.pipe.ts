import { HttpStatus, Injectable, type PipeTransform } from '@nestjs/common';

import { zodIssuesToFieldErrors } from '@casebook/contracts';

import { PROBLEM_TYPES, ProblemException } from '../problem.exception.js';

import type { z } from 'zod';

/**
 * Valida body/query/params contra um schema Zod. Em falha lança um 422 em Problem
 * Details com `errors` por campo. Só este pipe faz essa conversão: um `ZodError`
 * lançado em qualquer outro ponto é erro interno (500).
 *
 *   @Post() create(@Body(new ZodValidationPipe(createProjectSchema)) body: CreateProject)
 */
@Injectable()
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    throw new ProblemException({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      type: PROBLEM_TYPES.validation,
      title: 'Requisição inválida',
      detail: 'Um ou mais campos não passaram na validação.',
      errors: zodIssuesToFieldErrors(result.error),
    });
  }
}
