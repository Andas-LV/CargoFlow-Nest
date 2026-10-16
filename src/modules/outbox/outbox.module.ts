import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { NOTIFICATION_QUEUE, TRACKING_QUEUE } from '../../infra/queue/queues';
import { OutboxRelay } from './outbox.relay';
import { OutboxService } from './outbox.service';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: TRACKING_QUEUE },
      { name: NOTIFICATION_QUEUE },
    ),
  ],
  providers: [OutboxService, OutboxRelay],
  exports: [OutboxService],
})
export class OutboxModule {}
