import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TRACKING_QUEUE } from '../../infra/queue/queues';
import { OutboxModule } from '../outbox/outbox.module';
import { ShipmentsModule } from '../shipments/shipments.module';
import { StationsModule } from '../stations/stations.module';
import { TrackingController } from './tracking.controller';
import { TrackingProcessor } from './tracking.processor';
import { TrackingService } from './tracking.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: TRACKING_QUEUE }),
    ShipmentsModule,
    StationsModule,
    OutboxModule,
  ],
  controllers: [TrackingController],
  providers: [TrackingService, TrackingProcessor],
})
export class TrackingModule {}
