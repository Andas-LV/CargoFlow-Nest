import { AppError, Code } from './errors/app-error';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

/** Проверяет UUID из пути и приводит к нижнему регистру (как uuid.Parse + String() в Go). */
export function parseUuid(raw: string, field: string): string {
  if (!isUuid(raw)) {
    throw new AppError(Code.InvalidArgument, `${field} must be a UUID`);
  }
  return raw.toLowerCase();
}
