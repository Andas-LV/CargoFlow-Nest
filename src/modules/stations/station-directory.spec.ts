import type { Station } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalize, StationDirectory } from './station-directory';
import { parseStationsCsv } from './stations.csv';

const st = (p: Partial<Station> & Pick<Station, 'id' | 'nameRu'>): Station => ({
  esr: '',
  kind: 'station',
  name: p.nameRu,
  nameKk: '',
  nameEn: '',
  lat: 0,
  lon: 0,
  ...p,
});

describe('normalize', () => {
  it('складывает казахские буквы, ё и дефисы', () => {
    expect(normalize('Жезқазған')).toBe('жезказган');
    expect(normalize('  Алматы-1  ')).toBe('алматы 1');
    expect(normalize('Семёновка')).toBe('семеновка');
    expect(normalize('Өскемен  Іі')).toBe('оскемен ии');
  });
});

describe('StationDirectory.search', () => {
  const dir = new StationDirectory([
    st({ id: 'a1', nameRu: 'Алматы-1', esr: '700002' }),
    st({ id: 'a2', nameRu: 'Алматы-2' }),
    st({ id: 'z', nameRu: 'Жезказган', nameKk: 'Жезқазған' }),
    st({ id: 'h', nameRu: 'Алмалы', kind: 'halt' }),
    st({ id: 's', nameRu: 'Алмалыбак' }),
    st({ id: 'w', nameRu: 'Большое Алмалы' }),
    st({ id: 'sub', nameRu: 'Талмалы' }),
  ]);
  const ids = (q: string, limit = 0) => dir.search(q, limit).map((s) => s.id);

  it('находит с русской раскладки и без дефиса', () => {
    expect(ids('жезқазған')).toEqual(['z']);
    expect(ids('алматы 1')).toEqual(['a1']);
  });

  it('ищет по ЕСР', () => {
    expect(ids('700002')).toEqual(['a1']);
  });

  it('ранжирует: точное, префикс, префикс слова, подстрока; станции раньше остановок', () => {
    // "алмалы": h точное (0), s префикс (1), w префикс слова (2), sub подстрока (3)
    expect(ids('алмалы')).toEqual(['h', 's', 'w', 'sub']);
    // одинаковый ранг: станции раньше остановок, потом по nameRu
    expect(ids('алм')).toEqual(['s', 'a1', 'a2', 'h', 'w', 'sub']);
  });

  it('пустой запрос — пусто; limit по умолчанию 20, максимум 50', () => {
    expect(ids('   ')).toEqual([]);
    expect(ids('алм', 2)).toEqual(['s', 'a1']);
    const many = new StationDirectory(
      Array.from({ length: 80 }, (_, i) =>
        st({ id: `x${i}`, nameRu: `Станция ${i}` }),
      ),
    );
    expect(many.search('станция', 0)).toHaveLength(20);
    expect(many.search('станция', 500)).toHaveLength(50);
  });
});

describe('parseStationsCsv', () => {
  it('разбирает справочник из data/', () => {
    const csv = readFileSync(
      join(__dirname, '../../../data/stations_kz.csv'),
      'utf8',
    );
    const stations = parseStationsCsv(csv);
    expect(stations.length).toBeGreaterThan(1000);
    expect(new Set(stations.map((s) => s.id)).size).toBe(stations.length);
    for (const s of stations) {
      expect(['station', 'halt']).toContain(s.kind);
      expect(Number.isFinite(s.lat) && Number.isFinite(s.lon)).toBe(true);
    }
    const dir = new StationDirectory(stations);
    expect(dir.search('алматы 1', 5).map((s) => s.nameRu)).toContain(
      'Алматы-1',
    );
  });

  it('ругается на кривые строки', () => {
    const header = 'id,esr,kind,name,name_ru,name_kk,name_en,lat,lon\n';
    expect(() => parseStationsCsv(header)).toThrow('empty');
    expect(() => parseStationsCsv(header + 'a,,station,A,А,,,1\n')).toThrow(
      'columns',
    );
    expect(() => parseStationsCsv(header + 'a,,station,A,А,,,x,1\n')).toThrow(
      'coordinates',
    );
  });
});
