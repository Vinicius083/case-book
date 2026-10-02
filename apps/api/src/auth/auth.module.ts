import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { RateLimitModule } from '../rate-limit/rate-limit.module.js';

import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthGuard } from './guards/auth.guard.js';
import { PasswordService } from './password/password.service.js';
import { RefreshCookie } from './refresh-cookie.js';
import { AccessTokenService } from './tokens/access-token.service.js';
import { RefreshTokenService } from './tokens/refresh-token.service.js';
import { SessionDenylist } from './tokens/session-denylist.service.js';

@Module({
  imports: [RateLimitModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    AccessTokenService,
    RefreshTokenService,
    SessionDenylist,
    RefreshCookie,
    // Global: toda rota exige Bearer, salvo as marcadas com @Public().
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  // Troca de senha (em /me) é regra de sessão: fica no AuthService.
  exports: [AuthService],
})
export class AuthModule {}
