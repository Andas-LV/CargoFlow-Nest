import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import type { RedisOptions } from 'bullmq';
import Redis from 'ioredis';
import { AppConfig } from '../../config/app-config.service';

/** Токен общего ioredis-клиента (кеш, сессии, link-коды, rate limit). */
export const REDIS = Symbol('REDIS');

/**
 * Разбирает redis:// и rediss:// URL в опции подключения. Нужен BullMQ: ему передаём опции,
 * а не готовый клиент, чтобы он сам создавал и закрывал свои соединения.
 */
export function redisOptionsFromUrl(url: string): RedisOptions {
  const u = new URL(url);
  const db = Number(u.pathname.replace('/', '') || 0);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: Number.isInteger(db) ? db : 0,
    tls: u.protocol === 'rediss:' ? {} : undefined,
  };
}

@Injectable()
class RedisCloser implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => {
        const log = new Logger('Redis');
        const redis = new Redis(config.get('REDIS_URL'), {
          // Запрос не должен висеть, пока Redis лежит: кеш и rate limit работают в режиме fail-open.
          maxRetriesPerRequest: 2,
          commandTimeout: 2000,
        });
        redis.on('error', (e: Error) => log.warn(`redis: ${e.message}`));
        return redis;
      },
    },
    RedisCloser,
  ],
  exports: [REDIS],
})
export class RedisModule {}
