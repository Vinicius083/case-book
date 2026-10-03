import { Module } from '@nestjs/common';

import { MediaEventsController } from './media-events.controller.js';
import { MediaEventsService } from './media-events.service.js';
import { MediaController } from './media.controller.js';
import { MediaService } from './media.service.js';

@Module({
  controllers: [MediaEventsController, MediaController],
  providers: [MediaService, MediaEventsService],
})
export class MediaModule {}
