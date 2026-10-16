import type { Position } from '@prisma/client';
import { IsOptional, IsString } from 'class-validator';

export class AddPositionDto {
  @IsOptional()
  @IsString()
  stationId?: string;
}

export class PositionDto {
  id!: string;
  shipmentId!: string;
  stationId!: string;
  /** Название станции (рус.) на момент записи. */
  station!: string;
  lat!: number;
  lon!: number;
  /** "manual" или "shipment.created". */
  source!: string;
  recordedAt!: Date;
}

export class PositionResponse {
  position!: PositionDto;
}

export class RouteResponse {
  positions!: PositionDto[];
}

export function toPositionDto(p: Position): PositionDto {
  return {
    id: p.id,
    shipmentId: p.shipmentId,
    stationId: p.stationId,
    station: p.station,
    lat: p.lat,
    lon: p.lon,
    source: p.source,
    recordedAt: p.recordedAt,
  };
}
