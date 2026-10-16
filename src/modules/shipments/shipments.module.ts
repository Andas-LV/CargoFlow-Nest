import { Module } from '@nestjs/common';
import { OutboxModule } from '../outbox/outbox.module';
import { StationsModule } from '../stations/stations.module';
import { ShipmentsCache } from './shipments.cache';
import { ShipmentsController } from './shipments.controller';
import { ShipmentsService } from './shipments.service';

@Module({
  imports: [StationsModule, OutboxModule],
  controllers: [ShipmentsController],
  providers: [ShipmentsService, ShipmentsCache],
  exports: [ShipmentsService],
})
export class ShipmentsModule {}
