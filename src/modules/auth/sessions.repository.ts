import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../../infra/redis/redis.module';

const key = (jti: string) => `refresh:${jti}`;

/** Refresh-сессии в Redis: refresh:<jti> → userId. Каждый refresh-токен работает один раз. */
@Injectable()
export class SessionsRepository {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async save(jti: string, userId: string, ttlSec: number): Promise<void> {
    await this.redis.set(key(jti), userId, 'EX', ttlSec);
  }

  /** Атомарно читает и удаляет сессию; null — сессии нет (отозвана или уже использована). */
  async consume(jti: string): Promise<string | null> {
    return this.redis.getdel(key(jti));
  }
}
