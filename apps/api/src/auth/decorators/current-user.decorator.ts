import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { AuthUser } from '../auth.types.js';
import type { FastifyRequest } from 'fastify';

/** Injeta `{ id, familyId }` do access token. Só existe em rotas sem `@Public()`. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const { user } = context.switchToHttp().getRequest<FastifyRequest>();
  if (!user) throw new Error('@CurrentUser() usado em rota sem autenticação');
  return user satisfies AuthUser;
});
