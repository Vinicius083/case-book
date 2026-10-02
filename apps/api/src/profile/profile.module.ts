import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { HandlesModule } from '../handles/handles.module.js';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';

import { HandlesController } from './handles.controller.js';
import { MeController } from './me.controller.js';
import { ProfileService } from './profile.service.js';
import { PublicProfilesController } from './public-profiles.controller.js';

@Module({
  imports: [AuthModule, RateLimitModule, HandlesModule],
  controllers: [MeController, HandlesController, PublicProfilesController],
  providers: [ProfileService],
})
export class ProfileModule {}
