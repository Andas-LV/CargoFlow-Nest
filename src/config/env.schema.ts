import { z } from 'zod';

const sec = z.coerce.number().int().positive();
const posInt = z.coerce.number().int().positive();
// z.coerce.boolean() превратил бы строку "false" в true, поэтому разбираем руками.
const flag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().default(8080),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error'])
    .default('info'),
  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),
  SWAGGER_UI: flag,

  DATABASE_URL: z.string().url(),
  MIGRATE_ON_START: flag,

  REDIS_URL: z.string().url(),
  QUEUE_PREFIX: z.string().min(1).default('cargoflow'),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SEC: sec.default(900),
  JWT_REFRESH_TTL_SEC: sec.default(604800),
  JWT_ISSUER: z.string().default('cargoflow-auth'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),

  RATE_LIMIT_REQUESTS: posInt.default(100),
  RATE_LIMIT_WINDOW_SEC: sec.default(60),

  SHIPMENT_CACHE_TTL_SEC: sec.default(300),

  OUTBOX_POLL_INTERVAL_MS: posInt.default(1000),
  OUTBOX_BATCH_SIZE: posInt.default(100),
  QUEUE_JOB_ATTEMPTS: posInt.default(10),
  QUEUE_BACKOFF_MS: posInt.default(1000),

  TELEGRAM_BOT_TOKEN: z.string().default(''),
  TELEGRAM_LINK_TTL_SEC: sec.default(600),

  STATIONS_CSV_PATH: z.string().default('data/stations_kz.csv'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`invalid environment:\n${issues}`);
  }
  return parsed.data;
}
