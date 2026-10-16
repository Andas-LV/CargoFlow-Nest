import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface AuthUser {
  userId: string;
}

export type AuthedRequest = Request & { user?: AuthUser };

/** userId из access-токена; JwtAuthGuard кладёт его в request.user. */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    return req.user!.userId;
  },
);
