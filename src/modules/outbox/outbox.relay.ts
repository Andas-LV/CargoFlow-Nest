import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { Queue } from 'bullmq';
import { AppConfig } from '../../config/app-config.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NOTIFICATION_QUEUE, TRACKING_QUEUE } from '../../infra/queue/queues';
import { SUBJECT_SHIPMENT_CREATED } from './events';

interface OutboxRow {
  id: string;
  subject: string;
  payload: unknown;
}

/**
 * Раз в OUTBOX_POLL_INTERVAL_MS забирает неотправленные события и кладёт их в очереди.
 * FOR UPDATE SKIP LOCKED позволяет запускать несколько инстансов. Доставка at-least-once:
 * дубли отсекаются jobId = eventId и идемпотентными обработчиками.
 */
@Injectable()
export class OutboxRelay implements OnModuleInit {
  private readonly log = new Logger(OutboxRelay.name);
  private readonly batchSize: number;
  private readonly intervalMs: number;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: SchedulerRegistry,
    @InjectQueue(TRACKING_QUEUE) private readonly trackingQ: Queue,
    @InjectQueue(NOTIFICATION_QUEUE) private readonly notificationQ: Queue,
    config: AppConfig,
  ) {
    this.batchSize = config.get('OUTBOX_BATCH_SIZE');
    this.intervalMs = config.get('OUTBOX_POLL_INTERVAL_MS');
  }

  onModuleInit(): void {
    // Интервал из конфига, поэтому регистрируем вручную, а не через @Interval.
    const timer = setInterval(() => void this.tick(), this.intervalMs);
    this.scheduler.addInterval('outbox-relay', timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return; // прошлый проход ещё идёт
    this.running = true;
    try {
      const sent = await this.flush();
      if (sent > 0) this.log.debug(`outbox relay: sent ${sent}`);
    } catch (e) {
      this.log.error(`outbox relay: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Отправляет одну пачку; возвращает число отправленных событий. */
  async flush(): Promise<number> {
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<OutboxRow[]>`
          SELECT id::text AS id, subject, payload FROM outbox
          WHERE sent_at IS NULL
          ORDER BY created_at
          LIMIT ${this.batchSize}
          FOR UPDATE SKIP LOCKED`;
        if (rows.length === 0) return 0;

        const sent: string[] = [];
        for (const row of rows) {
          try {
            await this.publish(row);
          } catch (e) {
            // Как в Go: останавливаемся на первой ошибке, отправленное помечаем, остальное повторим.
            this.log.warn(
              `outbox relay: publish ${row.subject} ${row.id}: ${(e as Error).message}`,
            );
            break;
          }
          sent.push(row.id);
        }
        if (sent.length > 0) {
          await tx.$executeRaw`
            UPDATE outbox SET sent_at = now() WHERE id = ANY(${sent}::uuid[])`;
        }
        return sent.length;
      },
      { timeout: 30_000 },
    );
  }

  private async publish(row: OutboxRow): Promise<void> {
    const opts = { jobId: row.id };
    await this.notificationQ.add(row.subject, row.payload, opts);
    if (row.subject === SUBJECT_SHIPMENT_CREATED) {
      await this.trackingQ.add(row.subject, row.payload, opts);
    }
  }
}
