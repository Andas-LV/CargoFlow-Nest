import { Controller, Get, Inject, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import type Redis from 'ioredis';
import { Public } from '../../common/auth/public.decorator';
import { SkipRateLimit } from '../../common/rate-limit/rate-limit.guard';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { REDIS } from '../../infra/redis/redis.module';

const CHECK_TIMEOUT_MS = 2000;

function withTimeout<T>(p: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** /healthz — процесс жив; /readyz — Postgres и Redis отвечают (иначе 503). */
@ApiExcludeController()
@Public()
@SkipRateLimit()
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get('healthz')
  healthz(): { status: string } {
    return { status: 'ok' };
  }

  @Get('readyz')
  async readyz(@Res() res: Response): Promise<void> {
    const checks: Record<string, () => Promise<unknown>> = {
      db: () => this.prisma.$queryRaw`SELECT 1`,
      redis: () => this.redis.ping(),
    };
    const result: Record<string, string> = {};
    let ok = true;
    await Promise.all(
      Object.entries(checks).map(async ([name, check]) => {
        try {
          await withTimeout(check());
          result[name] = 'ok';
        } catch (e) {
          ok = false;
          result[name] = (e as Error).message;
        }
      }),
    );
    res.status(ok ? 200 : 503).json(result);
  }
}
