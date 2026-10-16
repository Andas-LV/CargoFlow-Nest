import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { JwtAuthGuard } from './common/auth/jwt-auth.guard';
import { RateLimitGuard } from './common/rate-limit/rate-limit.guard';
import { AppConfig } from './config/app-config.service';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { RedisModule, redisOptionsFromUrl } from './infra/redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthController } from './modules/health/health.controller';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ShipmentsModule } from './modules/shipments/shipments.module';
import { StationsModule } from './modules/stations/stations.module';
import { TrackingModule } from './modules/tracking/tracking.module';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL'),
          transport:
            config.get('NODE_ENV') === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
          autoLogging: {
            ignore: (req) => req.url === '/healthz' || req.url === '/readyz',
          },
          // Токены в логи не пишем.
          redact: ['req.headers.authorization'],
        },
      }),
    }),
    PrismaModule,
    RedisModule,
    BullModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        // BullMQ требует maxRetriesPerRequest: null для блокирующих команд воркеров.
        connection: {
          ...redisOptionsFromUrl(config.get('REDIS_URL')),
          maxRetriesPerRequest: null,
        },
        prefix: config.get('QUEUE_PREFIX'),
        defaultJobOptions: {
          attempts: config.get('QUEUE_JOB_ATTEMPTS'),
          backoff: {
            type: 'exponential',
            delay: config.get('QUEUE_BACKOFF_MS'),
          },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      }),
    }),
    ScheduleModule.forRoot(),
    AuthModule,
    StationsModule,
    ShipmentsModule,
    TrackingModule,
    NotificationsModule,
  ],
  controllers: [HealthController],
  providers: [
    // Порядок важен: сначала rate limit, потом проверка токена (как в gateway).
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
