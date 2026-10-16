import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import type Redis from 'ioredis';
import { AppConfig } from '../../config/app-config.service';
import { REDIS } from '../../infra/redis/redis.module';
import { AppError, Code } from '../errors/app-error';

const SKIP_RATE_LIMIT = 'skipRateLimit';

/** Эндпоинт не учитывается в rate limit (health-пробы). */
export const SkipRateLimit = () => SetMetadata(SKIP_RATE_LIMIT, true);

/**
 * Fixed window на IP, общий для всех инстансов через Redis. Fail-open: если Redis недоступен,
 * запрос пропускается.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly log = new Logger(RateLimitGuard.name);
  private readonly limit: number;
  private readonly windowSec: number;

  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS) private readonly redis: Redis,
    config: AppConfig,
  ) {
    this.limit = config.get('RATE_LIMIT_REQUESTS');
    this.windowSec = config.get('RATE_LIMIT_WINDOW_SEC');
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (skip) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const bucket = Math.floor(Date.now() / (this.windowSec * 1000));
    const key = `rl:${req.ip}:${bucket}`;

    let count: number;
    try {
      const results = await this.redis
        .multi()
        .incr(key)
        .expire(key, this.windowSec)
        .exec();
      const [err, n] = results?.[0] ?? [new Error('empty MULTI result')];
      if (err) throw err;
      count = n as number;
    } catch (e) {
      this.log.warn(
        `rate limit: redis error, allowing request: ${(e as Error).message}`,
      );
      return true;
    }

    res.setHeader('X-RateLimit-Limit', this.limit);
    res.setHeader('X-RateLimit-Remaining', Math.max(this.limit - count, 0));
    if (count > this.limit) {
      res.setHeader('Retry-After', this.windowSec);
      throw new AppError(Code.ResourceExhausted, 'rate limit exceeded');
    }
    return true;
  }
}
