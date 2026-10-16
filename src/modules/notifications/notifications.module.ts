import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { NOTIFICATION_QUEUE } from '../../infra/queue/queues';
import { LinkCodesRepository } from './link-codes.repository';
import { NotificationsController } from './notifications.controller';
import { NotificationsProcessor } from './notifications.processor';
import { NotificationsService } from './notifications.service';
import { TelegramBot } from './telegram.bot';
import { TelegramClient } from './telegram.client';

@Module({
  imports: [BullModule.registerQueue({ name: NOTIFICATION_QUEUE })],
  controllers: [NotificationsController],
  providers: [
    TelegramClient,
    TelegramBot,
    NotificationsService,
    LinkCodesRepository,
    NotificationsProcessor,
  ],
})
export class NotificationsModule {}
