import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TokensService } from '../../modules/auth/tokens.service';
import { AppError, Code } from '../errors/app-error';
import { isUuid } from '../uuid';
import type { AuthedRequest } from './current-user.decorator';
import { IS_PUBLIC } from './public.decorator';

/** Глобальный guard: требует "Authorization: Bearer <access token>" везде, кроме @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) {
      throw new AppError(Code.Unauthenticated, 'missing bearer token');
    }

    let userId: string;
    try {
      userId = await this.tokens.parseAccess(token);
    } catch {
      throw new AppError(Code.Unauthenticated, 'invalid or expired token');
    }
    if (!isUuid(userId)) {
      throw new AppError(Code.Unauthenticated, 'malformed user identity');
    }
    req.user = { userId: userId.toLowerCase() };
    return true;
  }
}
