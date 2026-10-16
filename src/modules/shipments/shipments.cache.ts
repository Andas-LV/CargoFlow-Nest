import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { AppConfig } from '../../config/app-config.service';
import { REDIS } from '../../infra/redis/redis.module';
import type { ShipmentRow } from './shipment.dto';

const key = (id: string) => `shipment:v2:${id}`;

/** Кеш заявок в Redis (read-through). Ошибки Redis вызывающий код только логирует. */
@Injectable()
export class ShipmentsCache {
  private readonly ttlSec: number;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    config: AppConfig,
  ) {
    this.ttlSec = config.get('SHIPMENT_CACHE_TTL_SEC');
  }

  async get(id: string): Promise<ShipmentRow | null> {
    const raw = await this.redis.get(key(id));
    if (raw === null) return null;
    const s = JSON.parse(raw) as ShipmentRow;
    return {
      ...s,
      createdAt: new Date(s.createdAt),
      updatedAt: new Date(s.updatedAt),
    };
  }

  async set(s: ShipmentRow): Promise<void> {
    await this.redis.set(key(s.id), JSON.stringify(s), 'EX', this.ttlSec);
  }

  async delete(id: string): Promise<void> {
    await this.redis.del(key(id));
  }
}
