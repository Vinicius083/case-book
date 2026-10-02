import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';

import {
  type AuthToken,
  type LoginInput,
  loginSchema,
  type SignupInput,
  signupSchema,
} from '@casebook/contracts/auth';

import { requestMeta } from '../common/http/request-meta.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';

import { AuthService, type Session } from './auth.service.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { Public } from './decorators/public.decorator.js';
import {
  LOGIN_FAILURES,
  loginByIp,
  loginByIpAndEmail,
  refreshByFamily,
  signupByIp,
} from './rate-limit.keys.js';
import { readRefreshCookie, RefreshCookie } from './refresh-cookie.js';

import type { AuthUser } from './auth.types.js';
import type { FastifyReply, FastifyRequest } from 'fastify';

const MINUTE = 60;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookie: RefreshCookie,
  ) {}

  @Public()
  @RateLimit({ key: signupByIp, limit: 5, windowSec: 60 * MINUTE })
  @Post('signup')
  async signup(
    @Body(new ZodValidationPipe(signupSchema)) body: SignupInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthToken> {
    return this.respond(reply, await this.auth.signup(body, requestMeta(request)));
  }

  @Public()
  @RateLimit(
    { key: loginByIp, limit: 30, windowSec: 15 * MINUTE },
    // Só consulta: o AuthService registra as falhas e zera no login bem-sucedido.
    { key: loginByIpAndEmail, ...LOGIN_FAILURES, consume: false },
  )
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthToken> {
    return this.respond(reply, await this.auth.login(body, requestMeta(request)));
  }

  // Público: o access token costuma estar expirado aqui; a credencial é o cookie.
  @Public()
  @RateLimit({ key: refreshByFamily, limit: 60, windowSec: MINUTE })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthToken> {
    try {
      const session = await this.auth.refresh(readRefreshCookie(request), requestMeta(request));
      return this.respond(reply, session);
    } catch (error) {
      // Cookie que não serve mais não tem por que continuar no browser.
      this.cookie.clear(reply);
      throw error;
    }
  }

  // Público pelo mesmo motivo do refresh: dá para sair com o access token expirado.
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.auth.logout(readRefreshCookie(request), requestMeta(request));
    this.cookie.clear(reply);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutAll(
    @CurrentUser() user: AuthUser,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.auth.logoutAll(user, requestMeta(request));
    this.cookie.clear(reply);
  }

  private respond(reply: FastifyReply, session: Session): AuthToken {
    this.cookie.set(reply, session.refreshToken);
    // Resposta carrega credencial: nenhum cache intermediário pode guardá-la.
    void reply.header('cache-control', 'no-store');
    return session.body;
  }
}
