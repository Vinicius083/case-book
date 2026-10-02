/** Usuário autenticado, extraído do access token pelo AuthGuard. */
export interface AuthUser {
  id: string;
  /** Família de refresh tokens (claim `sid`): identifica a sessão. */
  familyId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}
