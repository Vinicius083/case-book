import { Injectable, type PipeTransform } from '@nestjs/common';

import type { z } from 'zod';

/**
 * Valida body/query/params contra um schema Zod. Em falha lança o próprio
 * `ZodError`, que o ProblemDetailsFilter converte em 422 com `errors` por campo.
 *
 *   @Post() create(@Body(new ZodValidationPipe(createProjectSchema)) body: CreateProject)
 */
@Injectable()
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    return this.schema.parse(value);
  }
}
