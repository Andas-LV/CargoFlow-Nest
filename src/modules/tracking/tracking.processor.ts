import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { TRACKING_QUEUE } from '../../infra/queue/queues';
import {
  SUBJECT_SHIPMENT_CREATED,
  type ShipmentCreatedEvent,
} from '../outbox/events';
import { TrackingService } from './tracking.service';

@Processor(TRACKING_QUEUE)
export class TrackingProcessor extends WorkerHost {
  private readonly log = new Logger(TrackingProcessor.name);

  constructor(private readonly tracking: TrackingService) {
    super();
  }

  async process(job: Job): Promise<void> {
    // Битое или неизвестное событие не бросаем, иначе оно будет ретраиться вечно.
    if (job.name !== SUBJECT_SHIPMENT_CREATED) {
      this.log.warn(`skip event ${job.name} (${job.id})`);
      return;
    }
    const ev = job.data as ShipmentCreatedEvent | null;
    if (!ev || typeof ev !== 'object') {
      this.log.error(`drop malformed event ${job.name} (${job.id})`);
      return;
    }
    await this.tracking.handleShipmentCreated(ev);
  }
}
