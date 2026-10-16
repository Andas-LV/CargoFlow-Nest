import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AppError, Code } from '../../common/errors/app-error';
import { intQuery, stringQuery } from '../../common/query';
import {
  StationListResponse,
  StationResponse,
  toStationDto,
} from './station.dto';
import { StationsService } from './stations.service';

@ApiTags('stations')
@ApiBearerAuth()
@Controller('v1/stations')
export class StationsController {
  constructor(private readonly stations: StationsService) {}

  @Get()
  @ApiQuery({ name: 'query', required: true })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  search(
    @Query('query') rawQuery: unknown,
    @Query('pageSize') rawPageSize: unknown,
  ): StationListResponse {
    const query = stringQuery(rawQuery);
    if (!query.trim()) {
      throw new AppError(Code.InvalidArgument, 'query is required');
    }
    const found = this.stations.search(
      query,
      intQuery(rawPageSize, 'pageSize'),
    );
    return { stations: found.map(toStationDto) };
  }

  @Get(':id')
  get(@Param('id') id: string): StationResponse {
    const station = this.stations.get(id);
    if (!station) throw new AppError(Code.NotFound, 'station not found');
    return { station: toStationDto(station) };
  }
}
