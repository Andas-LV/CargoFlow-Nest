import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { parseUuid } from '../../common/uuid';
import {
  AddPositionDto,
  PositionResponse,
  RouteResponse,
  toPositionDto,
} from './position.dto';
import { TrackingService } from './tracking.service';

@ApiTags('tracking')
@ApiBearerAuth()
@Controller('v1/shipments/:shipmentId')
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Post('positions')
  @HttpCode(200)
  async addPosition(
    @CurrentUser() userId: string,
    @Param('shipmentId') rawShipmentId: string,
    @Body() body: AddPositionDto,
  ): Promise<PositionResponse> {
    const position = await this.tracking.addPosition(
      userId,
      parseUuid(rawShipmentId, 'shipment_id'),
      body.stationId ?? '',
    );
    return { position: toPositionDto(position) };
  }

  @Get('route')
  async getRoute(
    @CurrentUser() userId: string,
    @Param('shipmentId') rawShipmentId: string,
  ): Promise<RouteResponse> {
    const route = await this.tracking.getRoute(
      userId,
      parseUuid(rawShipmentId, 'shipment_id'),
    );
    return { positions: route.map(toPositionDto) };
  }
}
