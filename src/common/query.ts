import { AppError, Code } from './errors/app-error';

/** Целое из query-строки; отсутствует → 0 (как незаполненное поле protobuf). */
export function intQuery(raw: unknown, name: string): number {
  if (raw === undefined || raw === '') return 0;
  const n = typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < -2_147_483_648 || n > 2_147_483_647) {
    throw new AppError(Code.InvalidArgument, `${name} must be an integer`);
  }
  return n;
}

/** Строка из query-строки; повторённый параметр (?q=a&q=b) берём первым значением. */
export function stringQuery(raw: unknown): string {
  if (Array.isArray(raw)) return stringQuery(raw[0]);
  return typeof raw === 'string' ? raw : '';
}
