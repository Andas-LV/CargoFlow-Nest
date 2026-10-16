import type { Station } from '@prisma/client';
import { KIND_HALT, KIND_STATION } from './station-directory';

export enum StationKind {
  Unspecified = 'STATION_KIND_UNSPECIFIED',
  Station = 'STATION_KIND_STATION',
  Halt = 'STATION_KIND_HALT',
}

const kindToApi: Record<string, StationKind> = {
  [KIND_STATION]: StationKind.Station,
  [KIND_HALT]: StationKind.Halt,
};

export class StationDto {
  id!: string;
  /** Код ЕСР (6 цифр) или пустая строка. */
  esr!: string;
  kind!: StationKind;
  name!: string;
  nameRu!: string;
  nameKk!: string;
  nameEn!: string;
  lat!: number;
  lon!: number;
}

export class StationResponse {
  station!: StationDto;
}

export class StationListResponse {
  stations!: StationDto[];
}

/** Станция наружу. Неизвестная станция (не должно случаться) отдаётся пустой, как в protojson. */
export function toStationDto(s: Station | undefined): StationDto {
  return {
    id: s?.id ?? '',
    esr: s?.esr ?? '',
    kind: (s && kindToApi[s.kind]) ?? StationKind.Unspecified,
    name: s?.name ?? '',
    nameRu: s?.nameRu ?? '',
    nameKk: s?.nameKk ?? '',
    nameEn: s?.nameEn ?? '',
    lat: s?.lat ?? 0,
    lon: s?.lon ?? 0,
  };
}
