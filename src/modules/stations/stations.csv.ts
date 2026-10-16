import type { Station } from '@prisma/client';
import { parse } from 'csv-parse/sync';

const COLUMNS = 9;

/** Разбирает stations_kz.csv (заголовок: id,esr,kind,name,name_ru,name_kk,name_en,lat,lon). */
export function parseStationsCsv(data: string): Station[] {
  const rows: string[][] = parse(data, { relax_column_count: true });
  if (rows.length < 2) throw new Error('stations csv is empty');

  return rows.slice(1).map((row, i) => {
    const line = i + 2;
    if (row.length !== COLUMNS) {
      throw new Error(
        `stations csv line ${line}: want ${COLUMNS} columns, got ${row.length}`,
      );
    }
    const [id, esr, kind, name, nameRu, nameKk, nameEn, lat, lon] = row;
    const latN = Number(lat);
    const lonN = Number(lon);
    if (!lat || !lon || !Number.isFinite(latN) || !Number.isFinite(lonN)) {
      throw new Error(`stations csv line ${line}: bad coordinates`);
    }
    return {
      id,
      esr,
      kind,
      name,
      nameRu,
      nameKk,
      nameEn,
      lat: latN,
      lon: lonN,
    };
  });
}
