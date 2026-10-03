import { Controller, Get, Req, Res } from '@nestjs/common';

import { MEDIA_EVENT_NAME } from '@casebook/contracts/media';

import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ACCESS_TOKEN_TTL_SEC } from '../auth/tokens/access-token.service.js';

import { MediaEventsService } from './media-events.service.js';

import type { AuthUser } from '../auth/auth.types.js';
import type { FastifyReply, FastifyRequest } from 'fastify';

/** Comentário SSE periódico: mantém a conexão viva em proxies que cortam conexão ociosa. */
export const SSE_HEARTBEAT_MS = 15_000;

/**
 * `GET /media/events` (RF-UP-5): Server-Sent Events com o estado da mídia do
 * usuário do token. Autenticado por Bearer — o front lê com `fetch` em stream,
 * porque `EventSource` não manda header.
 */
@Controller('media')
export class MediaEventsController {
  constructor(private readonly events: MediaEventsService) {}

  @Get('events')
  async stream(
    @CurrentUser() user: AuthUser,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    // A resposta passa a ser escrita à mão, sem serialização do Fastify.
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      // no-transform: proxy não pode comprimir nem reempacotar o stream.
      'cache-control': 'no-cache, no-transform',
      // nginx/Caddy e similares: não bufferizar.
      'x-accel-buffering': 'no',
      connection: 'keep-alive',
    });
    // `retry`: o cliente espera 3s para reconectar. O comentário inicial faz os
    // headers e o primeiro byte saírem já, sem esperar o primeiro evento.
    res.write('retry: 3000\n: conectado\n\n');

    const unsubscribe = await this.events.subscribe(user.id, (payload) => {
      res.write(`event: ${MEDIA_EVENT_NAME}\ndata: ${payload}\n\n`);
    });
    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, SSE_HEARTBEAT_MS);
    // A conexão não vive mais que o access token: o cliente reconecta com um
    // token novo, e uma sessão revogada para de receber eventos.
    const expiry = setTimeout(() => {
      res.end();
    }, ACCESS_TOKEN_TTL_SEC * 1000);

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      clearTimeout(expiry);
      void unsubscribe();
    };
    request.raw.once('close', close);
    res.once('close', close);
    // Cliente que desistiu enquanto a assinatura era feita: o `close` já passou.
    if (request.raw.destroyed || res.destroyed || request.raw.socket.destroyed) close();
  }
}
