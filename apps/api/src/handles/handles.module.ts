import { Module } from '@nestjs/common';

import { HandleReservationsService } from './handle-reservations.service.js';

@Module({ providers: [HandleReservationsService], exports: [HandleReservationsService] })
export class HandlesModule {}
