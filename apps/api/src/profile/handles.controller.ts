import { Controller, Get, Param, Req } from '@nestjs/common';

import type { HandleAvailability } from '@casebook/contracts/handle';

import { Public } from '../auth/decorators/public.decorator.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { byIp } from '../rate-limit/rate-limit.keys.js';

import { ProfileService } from './profile.service.js';

import type { FastifyRequest } from 'fastify';

@Controller('handles')
export class HandlesController {
  constructor(private readonly profiles: ProfileService) {}

  // O limite também freia a enumeração de handles existentes.
  @Public()
  @RateLimit({ key: byIp('handle-availability'), limit: 30, windowSec: 60 })
  @Get(':handle/availability')
  availability(
    @Param('handle') handle: string,
    @Req() request: FastifyRequest,
  ): Promise<HandleAvailability> {
    // Bearer opcional: quem está logado não vê a própria quarentena como "reservado".
    return this.profiles.handleAvailability(handle, request.user?.id);
  }
}
