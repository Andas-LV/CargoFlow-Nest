import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Tx } from '../../infra/prisma/prisma.service';
import type { EventsBySubject, Subject } from './events';

/** Пишет событие в outbox в той же транзакции, что и изменение данных. */
@Injectable()
export class OutboxService {
  async enqueue<S extends Subject>(
    tx: Tx,
    subject: S,
    event: EventsBySubject[S],
  ): Promise<void> {
    await tx.outbox.create({
      data: {
        id: event.eventId,
        subject,
        payload: event as unknown as Prisma.InputJsonObject,
      },
    });
  }
}
