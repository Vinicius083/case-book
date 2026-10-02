import type { FastifyRequest } from 'fastify';

/** Origem da requisição, gravada em `refresh_tokens` e nos metadados de auditoria. */
export interface RequestMeta {
  /** IP do cliente. Só considera `X-Forwarded-For` com `TRUST_PROXY=true`. */
  ip: string;
  userAgent: string | null;
}

const USER_AGENT_MAX_LENGTH = 512;

export function requestMeta(request: FastifyRequest): RequestMeta {
  const userAgent = request.headers['user-agent'];
  return {
    ip: request.ip,
    userAgent: userAgent ? userAgent.slice(0, USER_AGENT_MAX_LENGTH) : null,
  };
}
