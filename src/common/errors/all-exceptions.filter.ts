import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { AppError, Code, codeFromHttp, statusOf } from './app-error';

/** Все ошибки наружу в формате grpc-gateway: {code, message, details}. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger(AllExceptionsFilter.name);

  catch(err: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const { code, message } = this.toBody(err);
    res.status(statusOf(code)).json({ code, message, details: [] });
  }

  private toBody(err: unknown): { code: Code; message: string } {
    if (err instanceof AppError) {
      return { code: err.code, message: err.message };
    }
    if (err instanceof BadRequestException) {
      // ValidationPipe и битый JSON в теле запроса.
      const r = err.getResponse();
      const msg =
        typeof r === 'object' && r !== null && 'message' in r
          ? [r.message].flat().join('; ')
          : err.message;
      return { code: Code.InvalidArgument, message: `invalid input: ${msg}` };
    }
    if (err instanceof HttpException) {
      return { code: codeFromHttp(err.getStatus()), message: err.message };
    }
    if (isUnavailable(err)) {
      this.log.error(err);
      return { code: Code.Unavailable, message: 'service unavailable' };
    }
    this.log.error(err);
    return { code: Code.Internal, message: 'internal error' };
  }
}

/** Postgres или Redis недоступны: отвечаем 503, а не 500. */
function isUnavailable(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientInitializationError) return true;
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return ['P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(err.code);
  }
  if (err instanceof Error) {
    return (
      err.name === 'MaxRetriesPerRequestError' ||
      err.message === 'Connection is closed.' ||
      err.message.startsWith('Command timed out')
    );
  }
  return false;
}
