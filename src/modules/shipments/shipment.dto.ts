import { CargoType, ShipmentStatus, type Shipment } from '@prisma/client';
import { IsOptional, IsString } from 'class-validator';
import { StationDto } from '../stations/station.dto';

// Enum'ы наружу в стиле protobuf: в БД "wagon", в JSON "CARGO_TYPE_WAGON".

export enum CargoTypeApi {
  Unspecified = 'CARGO_TYPE_UNSPECIFIED',
  Wagon = 'CARGO_TYPE_WAGON',
  Container = 'CARGO_TYPE_CONTAINER',
}

export enum ShipmentStatusApi {
  Unspecified = 'SHIPMENT_STATUS_UNSPECIFIED',
  Created = 'SHIPMENT_STATUS_CREATED',
  InTransit = 'SHIPMENT_STATUS_IN_TRANSIT',
  Delivered = 'SHIPMENT_STATUS_DELIVERED',
  Cancelled = 'SHIPMENT_STATUS_CANCELLED',
}

export const cargoToApi: Record<CargoType, CargoTypeApi> = {
  [CargoType.wagon]: CargoTypeApi.Wagon,
  [CargoType.container]: CargoTypeApi.Container,
};

// Map, а не объект: ключ из запроса не должен попадать в Object.prototype ("toString" и т.п.).
export const cargoFromApi = new Map<string, CargoType>([
  [CargoTypeApi.Wagon, CargoType.wagon],
  [CargoTypeApi.Container, CargoType.container],
]);

export const statusToApi: Record<ShipmentStatus, ShipmentStatusApi> = {
  [ShipmentStatus.created]: ShipmentStatusApi.Created,
  [ShipmentStatus.in_transit]: ShipmentStatusApi.InTransit,
  [ShipmentStatus.delivered]: ShipmentStatusApi.Delivered,
  [ShipmentStatus.cancelled]: ShipmentStatusApi.Cancelled,
};

export const statusFromApi = new Map<string, ShipmentStatus>([
  [ShipmentStatusApi.Created, ShipmentStatus.created],
  [ShipmentStatusApi.InTransit, ShipmentStatus.in_transit],
  [ShipmentStatusApi.Delivered, ShipmentStatus.delivered],
  [ShipmentStatusApi.Cancelled, ShipmentStatus.cancelled],
]);

export class CreateShipmentDto {
  @IsOptional()
  @IsString()
  cargoType?: CargoTypeApi;

  @IsOptional()
  @IsString()
  originStationId?: string;

  @IsOptional()
  @IsString()
  destinationStationId?: string;
}

export class UpdateShipmentStatusDto {
  @IsOptional()
  @IsString()
  status?: ShipmentStatusApi;
}

export class ShipmentDto {
  id!: string;
  ownerId!: string;
  cargoType!: CargoTypeApi;
  status!: ShipmentStatusApi;
  createdAt!: Date;
  updatedAt!: Date;
  originStation!: StationDto;
  destinationStation!: StationDto;
}

export class ShipmentResponse {
  shipment!: ShipmentDto;
}

export class ShipmentListResponse {
  shipments!: ShipmentDto[];
}

export type ShipmentRow = Shipment;
