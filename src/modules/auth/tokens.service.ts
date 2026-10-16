import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { AppConfig } from '../../config/app-config.service';

const AUDIENCE_ACCESS = 'access';
const AUDIENCE_REFRESH = 'refresh';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Время жизни access-токена в секундах. */
  expiresIn: number;
}

/** Токен не прошёл проверку: подпись, срок, issuer, audience или пустой sub. */
export class InvalidTokenError extends Error {
  constructor(reason: string) {
    super(`invalid token: ${reason}`);
    this.name = 'InvalidTokenError';
  }
}

interface Claims {
  jti?: string;
  sub?: string;
  exp?: number;
}

/** JWT HS256 с разными секретами для access и refresh, как в Go-сервисе auth. */
@Injectable()
export class TokensService {
  private readonly issuer: string;
  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  readonly accessTtlSec: number;
  readonly refreshTtlSec: number;

  constructor(
    private readonly jwt: JwtService,
    config: AppConfig,
  ) {
    this.issuer = config.get('JWT_ISSUER');
    this.accessSecret = config.get('JWT_ACCESS_SECRET');
    this.refreshSecret = config.get('JWT_REFRESH_SECRET');
    this.accessTtlSec = config.get('JWT_ACCESS_TTL_SEC');
    this.refreshTtlSec = config.get('JWT_REFRESH_TTL_SEC');
  }

  /** Выпускает пару токенов; refreshId — jti refresh-токена для сессии в Redis. */
  async issue(userId: string): Promise<{ pair: TokenPair; refreshId: string }> {
    const [access, refresh] = await Promise.all([
      this.sign(userId, AUDIENCE_ACCESS, this.accessTtlSec, this.accessSecret),
      this.sign(
        userId,
        AUDIENCE_REFRESH,
        this.refreshTtlSec,
        this.refreshSecret,
      ),
    ]);
    return {
      pair: {
        accessToken: access.token,
        refreshToken: refresh.token,
        expiresIn: this.accessTtlSec,
      },
      refreshId: refresh.id,
    };
  }

  /** Возвращает userId из access-токена. */
  async parseAccess(token: string): Promise<string> {
    const claims = await this.parse(token, AUDIENCE_ACCESS, this.accessSecret);
    return claims.sub;
  }

  async parseRefresh(
    token: string,
  ): Promise<{ userId: string; tokenId: string }> {
    const claims = await this.parse(
      token,
      AUDIENCE_REFRESH,
      this.refreshSecret,
    );
    if (!claims.jti) throw new InvalidTokenError('missing jti');
    return { userId: claims.sub, tokenId: claims.jti };
  }

  private async sign(
    userId: string,
    audience: string,
    ttlSec: number,
    secret: string,
  ): Promise<{ token: string; id: string }> {
    const id = randomUUID();
    const token = await this.jwt.signAsync(
      {},
      {
        secret,
        algorithm: 'HS256',
        jwtid: id,
        issuer: this.issuer,
        subject: userId,
        audience,
        expiresIn: ttlSec,
      },
    );
    return { token, id };
  }

  private async parse(
    token: string,
    audience: string,
    secret: string,
  ): Promise<Claims & { sub: string }> {
    let claims: Claims;
    try {
      claims = await this.jwt.verifyAsync<Claims>(token, {
        secret,
        algorithms: ['HS256'],
        issuer: this.issuer,
        audience,
      });
    } catch (e) {
      throw new InvalidTokenError((e as Error).message);
    }
    if (typeof claims.exp !== 'number') {
      throw new InvalidTokenError('missing exp');
    }
    if (!claims.sub) throw new InvalidTokenError('empty subject');
    return claims as Claims & { sub: string };
  }
}
