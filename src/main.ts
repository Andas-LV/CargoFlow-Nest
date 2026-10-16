import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Logger } from 'nestjs-pino';
import { execFileSync } from 'node:child_process';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { AppConfig } from './config/app-config.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  const config = app.get(AppConfig);

  // До app.init(): при старте StationsService уже пишет в таблицу stations.
  if (config.get('MIGRATE_ON_START')) {
    execFileSync(
      process.execPath,
      [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
      { stdio: 'inherit' },
    );
  }

  app.set('trust proxy', 1); // req.ip из X-Forwarded-For (Render и другие прокси)
  app.enableShutdownHooks(); // корректно остановить бота и BullMQ-воркеры
  app.enableCors({
    origin: config
      .get('CORS_ALLOWED_ORIGINS')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    exposedHeaders: [
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'Retry-After',
    ],
    maxAge: 600,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());

  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('CargoFlow API')
      .setVersion('1.0')
      .addBearerAuth()
      .build(),
  );
  app
    .getHttpAdapter()
    .get('/openapi.json', (_req: Request, res: Response) => res.json(doc));
  if (config.get('SWAGGER_UI')) SwaggerModule.setup('docs', app, doc);

  await app.listen(config.get('PORT'));
}

void bootstrap();
