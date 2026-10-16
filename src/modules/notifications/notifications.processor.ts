import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { GrammyError } from 'grammy';
import { NOTIFICATION_QUEUE } from '../../infra/queue/queues';
import {
  SUBJECT_POSITION_UPDATED,
  SUBJECT_SHIPMENT_CREATED,
  SUBJECT_SHIPMENT_STATUS_CHANGED,
  type PositionUpdatedEvent,
  type ShipmentCreatedEvent,
  type ShipmentStatusChangedEvent,
} from '../outbox/events';
import { cargoTypeRu, statusRu } from './locale.ru';
import { NotificationsService } from './notifications.service';
import { TelegramClient } from './telegram.client';

export interface Message {
  userId: string;
  title: string;
  text: string;
}

/** Текст уведомления по событию; null — событие неизвестное или битое. */
export function toMessage(subject: string, data: unknown): Message | null {
  if (!data || typeof data !== 'object') return null;
  switch (subject) {
    case SUBJECT_SHIPMENT_CREATED: {
      const ev = data as ShipmentCreatedEvent;
      return {
        userId: ev.ownerId,
        title: 'Заявка создана',
        text: `Заявка ${ev.shipmentId} (${cargoTypeRu(ev.cargoType)}): ${ev.origin} → ${ev.destination}`,
      };
    }
    case SUBJECT_SHIPMENT_STATUS_CHANGED: {
      const ev = data as ShipmentStatusChangedEvent;
      return {
        userId: ev.ownerId,
        title: 'Статус вагона изменен',
        text: `Заявка ${ev.shipmentId}: ${statusRu(ev.oldStatus)} → ${statusRu(ev.newStatus)}`,
      };
    }
    case SUBJECT_POSITION_UPDATED: {
      const ev = data as PositionUpdatedEvent;
      return {
        userId: ev.ownerId,
        title: 'Вагон перемещен',
        text: `Заявка ${ev.shipmentId}: ${ev.station}`,
      };
    }
    default:
      return null;
  }
}

@Processor(NOTIFICATION_QUEUE)
export class NotificationsProcessor extends WorkerHost {
  private readonly log = new Logger(NotificationsProcessor.name);

  constructor(
    private readonly telegram: TelegramClient,
    private readonly notifications: NotificationsService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    const msg = toMessage(job.name, job.data);
    if (!msg) {
      // Не бросаем: иначе битое событие ретраится вечно.
      this.log.warn(`skip event ${job.name} (${job.id})`);
      return;
    }
    if (!this.telegram.enabled) {
      this.log.debug(
        `telegram not configured, notification skipped: ${msg.title}`,
      );
      return;
    }

    const chatId = await this.notifications.chatId(msg.userId); // ошибка БД → ретрай
    if (chatId === null) {
      this.log.debug(
        `user ${msg.userId} has no telegram linked, skipped: ${msg.title}`,
      );
      return;
    }

    try {
      await this.telegram.sendMessage(chatId, `${msg.title}\n${msg.text}`);
    } catch (e) {
      // 403/400: бот заблокирован или чат удалён — повтор не поможет.
      if (e instanceof GrammyError && [400, 403].includes(e.error_code)) {
        this.log.warn(
          `telegram rejected notification for ${msg.userId}: ${e.description}`,
        );
        return;
      }
      throw e; // сеть, 429 или 5xx: BullMQ повторит
    }
    this.log.log(`telegram notification sent to ${msg.userId}: ${msg.title}`);
  }
}
