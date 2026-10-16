import { Injectable, Logger } from '@nestjs/common';
import type { Position } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../common/errors/app-error';
import { isUuid } from '../../common/uuid';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  SUBJECT_POSITION_UPDATED,
  SUBJECT_SHIPMENT_CREATED,
  type ShipmentCreatedEvent,
} from '../outbox/events';
import { OutboxService } from '../outbox/outbox.service';
import { ShipmentsService } from '../shipments/shipments.service';
import { StationsService } from '../stations/stations.service';

export const SOURCE_MANUAL = 'manual';

@Injectable()
export class TrackingService {
  private readonly log = new Logger(TrackingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shipments: ShipmentsService,
    private readonly stations: StationsService,
    private readonly outbox: OutboxService,
  ) {}

  /** Отметка «груз прошёл станцию». Статус заявки не проверяется (как в Go). */
  async addPosition(
    userId: string,
    shipmentId: string,
    rawStationId: string,
  ): Promise<Position> {
    const stationId = rawStationId.trim();
    if (!stationId) throw AppError.invalidInput('station_id is required');
    await this.shipments.get(userId, shipmentId); // чужая или нет → NOT_FOUND
    const station = this.stations.get(stationId);
    if (!station) {
      throw AppError.invalidInput(
        `unknown station ${JSON.stringify(stationId)}`,
      );
    }

    // В Go событие публиковалось после insert без outbox; здесь insert и событие в одной транзакции.
    return this.prisma.$transaction(async (tx) => {
      const p = await tx.position.create({
        data: {
          id: randomUUID(),
          shipmentId,
          stationId: station.id,
          station: station.nameRu,
          lat: station.lat,
          lon: station.lon,
          source: SOURCE_MANUAL,
          recordedAt: new Date(),
        },
      });
      await this.outbox.enqueue(tx, SUBJECT_POSITION_UPDATED, {
        eventId: p.id,
        shipmentId: p.shipmentId,
        ownerId: userId,
        stationId: p.stationId,
        station: p.station,
        lat: p.lat,
        lon: p.lon,
        occurredAt: p.recordedAt.toISOString(),
      });
      return p;
    });
  }

  async getRoute(userId: string, shipmentId: string): Promise<Position[]> {
    await this.shipments.get(userId, shipmentId);
    return this.prisma.position.findMany({
      where: { shipmentId },
      orderBy: { recordedAt: 'asc' },
    });
  }

  /** Первая точка маршрута — станция отправления. Повторная доставка события безопасна. */
  async handleShipmentCreated(ev: ShipmentCreatedEvent): Promise<void> {
    if (!isUuid(ev.eventId ?? '') || !isUuid(ev.shipmentId ?? '')) {
      this.log.error(
        `drop shipment.created with bad IDs: ${JSON.stringify(ev)}`,
      );
      return;
    }
    const station = this.stations.get(ev.originStationId);
    if (!station) {
      throw new Error(`origin station ${JSON.stringify(ev.originStationId)}`);
    }

    const { count } = await this.prisma.position.createMany({
      data: {
        id: ev.eventId,
        shipmentId: ev.shipmentId,
        stationId: station.id,
        station: station.nameRu,
        lat: station.lat,
        lon: station.lon,
        source: SUBJECT_SHIPMENT_CREATED,
        recordedAt: new Date(ev.occurredAt),
      },
      skipDuplicates: true, // ON CONFLICT (id) DO NOTHING
    });
    this.log.log(
      `route started: shipment ${ev.shipmentId}, station ${station.id}, inserted ${count > 0}`,
    );
  }
}
