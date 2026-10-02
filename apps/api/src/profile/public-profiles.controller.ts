import { Controller, Get, Header, Param } from '@nestjs/common';

import type { PublicProfileResponse } from '@casebook/contracts/profile';

import { Public } from '../auth/decorators/public.decorator.js';

import { ProfileService } from './profile.service.js';

@Public()
@Controller('public/profiles')
export class PublicProfilesController {
  constructor(private readonly profiles: ProfileService) {}

  @Get(':handle')
  @Header('cache-control', 'public, max-age=60')
  profile(@Param('handle') handle: string): Promise<PublicProfileResponse> {
    return this.profiles.getPublicProfile(handle);
  }
}
