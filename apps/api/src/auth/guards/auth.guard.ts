import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { trace } from '@opentelemetry/api';

import { ProblemException } from '../../common/problem.exception.js';
import { IS_PUBLIC } from '../decorators/public.decorator.js';
import { AccessTokenService } from '../tokens/access-token.service.js';
import { SessionDenylist } from '../tokens/session-denylist.service.js';

import type { AuthUser } from '../auth.types.js';
import type { FastifyRequest } from 'fastify';

/** Guard global: exige `Authorization: Bearer <access token>` em toda rota sem `@Public()`. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessTokens: AccessTokenService,
    private readonly denylist: SessionDenylist,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = /^Bearer (\S+)$/i.exec(request.headers.authorization ?? '')?.[1];

    if (isPublic) {
      // Rota pública aceita o Bearer como opcional: com token válido a resposta
      // pode considerar quem pergunta; sem ele (ou com um inválido), segue anônima.
      const user = token && (await this.authenticate(token).catch(() => undefined));
      if (user) request.user = user;
      return true;
    }

    if (!token) throw unauthorized('Access token ausente');
    const user = await this.authenticate(token);

    request.user = user;
    trace.getActiveSpan()?.setAttribute('user.id', user.id);
    return true;
  }

  private async authenticate(token: string): Promise<AuthUser> {
    let user: AuthUser;
    try {
      user = await this.accessTokens.verify(token);
    } catch {
      throw unauthorized('Access token inválido ou expirado');
    }
    // Sessão revogada antes do `exp` do token (reuso, troca de senha, logout-all).
    if (await this.denylist.isDenied(user.familyId)) throw unauthorized('Sessão revogada');
    return user;
  }
}

function unauthorized(detail: string): ProblemException {
  return new ProblemException({
    status: HttpStatus.UNAUTHORIZED,
    detail,
    headers: { 'www-authenticate': 'Bearer' },
  });
}
