import { z } from 'zod';

/**
 * W3C `traceparent` (`00-<trace-id>-<span-id>-<flags>`). BullMQ não propaga
 * contexto OTel sozinho: o produtor injeta este campo no payload e o worker
 * reconstrói o contexto, para o trace atravessar a fila.
 */
export const traceparentSchema = z
  .string()
  .regex(/^[\da-f]{2}-[\da-f]{32}-[\da-f]{16}-[\da-f]{2}$/, 'traceparent W3C inválido');

/** Campos obrigatórios em todo payload de job. */
export const jobBaseSchema = z.object({
  traceparent: traceparentSchema,
});

export type JobBase = z.infer<typeof jobBaseSchema>;

/** Monta o schema de um job estendendo a base. */
export function defineJobSchema<T extends z.ZodRawShape>(shape: T) {
  return jobBaseSchema.extend(shape);
}
