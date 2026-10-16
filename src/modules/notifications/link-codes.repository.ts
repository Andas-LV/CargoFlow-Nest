import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../../infra/redis/redis.module';

const key = (code: string) => `tglink:${code}`;

/** Одноразовые коды для deep-ссылки t.me/<bot>?start=<code>: tglink:<code> → userId. */
@Injectable()
export class LinkCodesRepository {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async save(code: string, userId: string, ttlSec: number): Promise<void> {
    await this.redis.set(key(code), userId, 'EX', ttlSec);
  }

  /** Атомарно читает и удаляет код; null — кода нет или он протух. */
  async consume(code: string): Promise<string | null> {
    return this.redis.getdel(key(code));
  }
}
