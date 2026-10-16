import type { Station } from '@prisma/client';

export const KIND_STATION = 'station';
export const KIND_HALT = 'halt';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// Казахские буквы, "ё" и дефис, чтобы искать с русской раскладки:
// "жезказган" находит "Жезқазған", "алматы 1" находит "Алматы-1".
const FOLD: Record<string, string> = {
  ә: 'а',
  ғ: 'г',
  қ: 'к',
  ң: 'н',
  ө: 'о',
  ұ: 'у',
  ү: 'у',
  һ: 'х',
  і: 'и',
  ё: 'е',
  '-': ' ',
};

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[әғқңөұүһіё-]/g, (c) => FOLD[c])
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

/** 0 — точное совпадение, 1 — префикс, 2 — префикс слова, 3 — подстрока, -1 — нет. */
export function matchRank(name: string, q: string): number {
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (name.includes(' ' + q)) return 2;
  if (name.includes(q)) return 3;
  return -1;
}

const kindOrder = (kind: string) => (kind === KIND_STATION ? 0 : 1);

// Побайтовое сравнение, как strings.Compare в Go (для кириллицы совпадает с порядком UTF-16).
const compareStrings = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

interface Entry {
  station: Station;
  keys: string[]; // нормализованные названия для поиска
}

/** Справочник станций в памяти (около 1 200 строк). */
export class StationDirectory {
  private readonly byId = new Map<string, Station>();
  private readonly all: Entry[] = [];

  constructor(stations: Station[]) {
    for (const s of stations) {
      this.byId.set(s.id, s);
      const keys: string[] = [];
      for (const name of [s.nameRu, s.name, s.nameKk, s.nameEn]) {
        const k = normalize(name);
        if (k && !keys.includes(k)) keys.push(k);
      }
      this.all.push({ station: s, keys });
    }
  }

  get size(): number {
    return this.byId.size;
  }

  get(id: string): Station | undefined {
    return this.byId.get(id);
  }

  /**
   * Ищет по всем названиям и по ЕСР. Порядок: точное совпадение, префикс, префикс слова,
   * подстрока; станции раньше остановочных пунктов; потом по nameRu.
   */
  search(query: string, limit: number): Station[] {
    const q = normalize(query);
    if (!q) return [];
    if (limit <= 0) limit = DEFAULT_LIMIT;
    limit = Math.min(limit, MAX_LIMIT);

    const hits: { station: Station; rank: number }[] = [];
    for (const e of this.all) {
      let best = e.station.esr !== '' && e.station.esr === q ? 0 : -1;
      for (const k of e.keys) {
        const r = matchRank(k, q);
        if (r >= 0 && (best < 0 || r < best)) best = r;
      }
      if (best >= 0) hits.push({ station: e.station, rank: best });
    }

    hits.sort(
      (a, b) =>
        a.rank - b.rank ||
        kindOrder(a.station.kind) - kindOrder(b.station.kind) ||
        compareStrings(a.station.nameRu, b.station.nameRu),
    );
    return hits.slice(0, limit).map((h) => h.station);
  }
}
