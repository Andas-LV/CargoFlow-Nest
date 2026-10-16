import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AppError, Code } from '../../common/errors/app-error';
import { intQuery } from '../../common/query';
import { parseUuid } from '../../common/uuid';
import { StationsService } from '../stations/stations.service';
import { toStationDto } from '../stations/station.dto';
import {
  cargoFromApi,
  cargoToApi,
  CreateShipmentDto,
  ShipmentDto,
  ShipmentListResponse,
  ShipmentResponse,
  ShipmentRow,
  statusFromApi,
  statusToApi,
  UpdateShipmentStatusDto,
} from './shipment.dto';
import { ShipmentsService } from './shipments.service';

@ApiTags('shipments')
@ApiBearerAuth()
@Controller('v1/shipments')
export class ShipmentsController {
  constructor(
    private readonly shipments: ShipmentsService,
    private readonly stations: StationsService,
  ) {}

  @Post()
  @HttpCode(200)
  async create(
    @CurrentUser() userId: string,
    @Body() body: CreateShipmentDto,
  ): Promise<ShipmentResponse> {
    const shipment = await this.shipments.create({
      ownerId: userId,
      cargoType: cargoFromApi.get(body.cargoType ?? ''),
      originStationId: body.originStationId ?? '',
      destinationStationId: body.destinationStationId ?? '',
    });
    return { shipment: this.toDto(shipment) };
  }

  @Get()
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  async list(
    @CurrentUser() userId: string,
    @Query('pageSize') rawPageSize: unknown,
  ): Promise<ShipmentListResponse> {
    const rows = await this.shipments.list(
      userId,
      intQuery(rawPageSize, 'pageSize'),
    );
    return { shipments: rows.map((s) => this.toDto(s)) };
  }

  @Get(':id')
  async get(
    @CurrentUser() userId: string,
    @Param('id') rawId: string,
  ): Promise<ShipmentResponse> {
    const shipment = await this.shipments.get(userId, parseUuid(rawId, 'id'));
    return { shipment: this.toDto(shipment) };
  }

  @Patch(':id/status')
  async updateStatus(
    @CurrentUser() userId: string,
    @Param('id') rawId: string,
    @Body() body: UpdateShipmentStatusDto,
  ): Promise<ShipmentResponse> {
    const id = parseUuid(rawId, 'id');
    const next = statusFromApi.get(body.status ?? '');
    if (!next) throw new AppError(Code.InvalidArgument, 'status is required');
    const shipment = await this.shipments.updateStatus(userId, id, next);
    return { shipment: this.toDto(shipment) };
  }

  private toDto(s: ShipmentRow): ShipmentDto {
    return {
      id: s.id,
      ownerId: s.ownerId,
      cargoType: cargoToApi[s.cargoType],
      status: statusToApi[s.status],
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      originStation: toStationDto(this.stations.get(s.originStationId)),
      destinationStation: toStationDto(
        this.stations.get(s.destinationStationId),
      ),
    };
  }
}
