import { Injectable, Logger } from '@nestjs/common';
import { CargoType, ShipmentStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AppError, Code } from '../../common/errors/app-error';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  SUBJECT_SHIPMENT_CREATED,
  SUBJECT_SHIPMENT_STATUS_CHANGED,
} from '../outbox/events';
import { OutboxService } from '../outbox/outbox.service';
import { StationsService } from '../stations/stations.service';
import type { ShipmentRow } from './shipment.dto';
import { ShipmentsCache } from './shipments.cache';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const TRANSITIONS: Partial<Record<ShipmentStatus, ShipmentStatus[]>> = {
  created: ['in_transit', 'cancelled'],
  in_transit: ['delivered', 'cancelled'],
};

export function canTransition(
  from: ShipmentStatus,
  to: ShipmentStatus,
): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

const notFound = () => new AppError(Code.NotFound, 'shipment not found');

export interface CreateShipmentInput {
  ownerId: string;
  cargoType: CargoType | undefined;
  originStationId: string;
  destinationStationId: string;
}

@Injectable()
export class ShipmentsService {
  private readonly log = new Logger(ShipmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: ShipmentsCache,
    private readonly stations: StationsService,
    private readonly outbox: OutboxService,
  ) {}

  async create(input: CreateShipmentInput): Promise<ShipmentRow> {
    const { cargoType } = input;
    if (cargoType !== CargoType.wagon && cargoType !== CargoType.container) {
      throw AppError.invalidInput('cargo_type is required');
    }
    const origin = this.stations.get(input.originStationId);
    if (!origin) {
      throw AppError.invalidInput(
        `unknown origin station ${JSON.stringify(input.originStationId)}`,
      );
    }
    const destination = this.stations.get(input.destinationStationId);
    if (!destination) {
      throw AppError.invalidInput(
        `unknown destination station ${JSON.stringify(input.destinationStationId)}`,
      );
    }
    if (origin.id === destination.id) {
      throw AppError.invalidInput('origin and destination must differ');
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.shipment.create({
        data: {
          id: randomUUID(),
          ownerId: input.ownerId,
          cargoType,
          status: ShipmentStatus.created,
          originStationId: origin.id,
          destinationStationId: destination.id,
        },
      });
      await this.outbox.enqueue(tx, SUBJECT_SHIPMENT_CREATED, {
        eventId: randomUUID(),
        shipmentId: created.id,
        ownerId: created.ownerId,
        cargoType: created.cargoType,
        origin: origin.nameRu,
        destination: destination.nameRu,
        originStationId: origin.id,
        destinationStationId: destination.id,
        occurredAt: created.createdAt.toISOString(),
      });
      return created;
    });
  }

  /** Заявка владельца; чужая выглядит как несуществующая. */
  async get(ownerId: string, id: string): Promise<ShipmentRow> {
    let shipment = await this.cache.get(id).catch((e: Error) => {
      this.log.warn(`shipment cache get: ${e.message}`);
      return null;
    });
    if (!shipment) {
      shipment = await this.prisma.shipment.findUnique({ where: { id } });
      if (!shipment) throw notFound();
      await this.cache
        .set(shipment)
        .catch((e: Error) => this.log.warn(`shipment cache set: ${e.message}`));
    }
    if (shipment.ownerId !== ownerId) throw notFound();
    return shipment;
  }

  async list(ownerId: string, pageSize: number): Promise<ShipmentRow[]> {
    if (pageSize <= 0) pageSize = DEFAULT_PAGE_SIZE;
    return this.prisma.shipment.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(pageSize, MAX_PAGE_SIZE),
    });
  }

  async updateStatus(
    ownerId: string,
    id: string,
    next: ShipmentStatus,
  ): Promise<ShipmentRow> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const [cur] = await tx.$queryRaw<
        { owner_id: string; status: ShipmentStatus }[]
      >`
        SELECT owner_id::text AS owner_id, status::text AS status
        FROM shipments WHERE id = ${id}::uuid FOR UPDATE`;
      if (!cur || cur.owner_id !== ownerId) throw notFound();
      if (!canTransition(cur.status, next)) {
        throw new AppError(
          Code.FailedPrecondition,
          `invalid status transition: ${cur.status} -> ${next}`,
        );
      }

      const row = await tx.shipment.update({
        where: { id },
        data: { status: next },
      });
      await this.outbox.enqueue(tx, SUBJECT_SHIPMENT_STATUS_CHANGED, {
        eventId: randomUUID(),
        shipmentId: row.id,
        ownerId: row.ownerId,
        oldStatus: cur.status,
        newStatus: row.status,
        occurredAt: row.updatedAt.toISOString(),
      });
      return row;
    });

    await this.cache
      .delete(id)
      .catch((e: Error) =>
        this.log.warn(`shipment cache delete: ${e.message}`),
      );
    return updated;
  }
}
