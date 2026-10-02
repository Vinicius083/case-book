import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Patch,
  Req,
  Res,
} from '@nestjs/common';

import {
  type ChangeHandleInput,
  changeHandleSchema,
  type ChangePasswordInput,
  changePasswordSchema,
  type MeResponse,
  type UpdateProfileInput,
  updateProfileSchema,
} from '@casebook/contracts/profile';

import { AuthService } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { requestMeta } from '../common/http/request-meta.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { byUser } from '../rate-limit/rate-limit.keys.js';

import { type MeWithEtag, ProfileService } from './profile.service.js';

import type { AuthUser } from '../auth/auth.types.js';
import type { FastifyReply, FastifyRequest } from 'fastify';

@Controller('me')
export class MeController {
  constructor(
    private readonly profiles: ProfileService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  async me(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MeResponse> {
    return respond(reply, await this.profiles.getMe(user.id));
  }

  @Patch('profile')
  async updateProfile(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateProfileSchema)) body: UpdateProfileInput,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MeResponse> {
    const updated = await this.profiles.updateProfile(user.id, body, ifMatch, requestMeta(request));
    return respond(reply, updated);
  }

  @Patch('handle')
  async changeHandle(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(changeHandleSchema)) body: ChangeHandleInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MeResponse> {
    const updated = await this.profiles.changeHandle(user.id, body.handle, requestMeta(request));
    return respond(reply, updated);
  }

  // Limita a adivinhação da senha atual por quem tem só um access token roubado.
  @RateLimit({ key: byUser('password-change'), limit: 5, windowSec: 15 * 60 })
  @Patch('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.auth.changePassword(user, body, requestMeta(request));
  }
}

function respond(reply: FastifyReply, { me, etag }: MeWithEtag): MeResponse {
  void reply.header('etag', etag).header('cache-control', 'private, no-store');
  return me;
}
