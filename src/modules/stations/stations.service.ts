import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Station } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AppConfig } from '../../config/app-config.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StationDirectory } from './station-directory';
import { parseStationsCsv } from './stations.csv';

/**
 * Справочник станций. При старте синхронизирует CSV в таблицу stations (только upsert, ничего
 * не удаляет: на станции ссылаются заявки), затем держит всю таблицу в памяти.
 */
@Injectable()
export class StationsService implements OnModuleInit {
  private readonly log = new Logger(StationsService.name);
  private directory = new StationDirectory([]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    const path = resolve(this.config.get('STATIONS_CSV_PATH'));
    const stations = parseStationsCsv(await readFile(path, 'utf8'));
    await this.sync(stations);
    this.directory = new StationDirectory(await this.prisma.station.findMany());
    this.log.log(`station directory loaded: ${this.directory.size} stations`);
  }

  get(id: string): Station | undefined {
    return this.directory.get(id);
  }

  search(query: string, limit: number): Station[] {
    return this.directory.search(query, limit);
  }

  /** Upsert всех станций одним запросом. */
  private async sync(stations: Station[]): Promise<void> {
    const col = <K extends keyof Station>(k: K) => stations.map((s) => s[k]);
    await this.prisma.$executeRaw`
      INSERT INTO stations (id, esr, kind, name, name_ru, name_kk, name_en, lat, lon)
      SELECT * FROM unnest(
        ${col('id')}::text[], ${col('esr')}::text[], ${col('kind')}::text[],
        ${col('name')}::text[], ${col('nameRu')}::text[], ${col('nameKk')}::text[],
        ${col('nameEn')}::text[], ${col('lat')}::float8[], ${col('lon')}::float8[])
      ON CONFLICT (id) DO UPDATE SET
        esr = EXCLUDED.esr, kind = EXCLUDED.kind, name = EXCLUDED.name,
        name_ru = EXCLUDED.name_ru, name_kk = EXCLUDED.name_kk, name_en = EXCLUDED.name_en,
        lat = EXCLUDED.lat, lon = EXCLUDED.lon`;
  }
}
