import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { AppError, Code } from '../../common/errors/app-error';
import { AppConfig } from '../../config/app-config.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { SessionsRepository } from './sessions.repository';
import { InvalidTokenError, TokenPair, TokensService } from './tokens.service';

const MIN_PASSWORD_LEN = 8;
const MAX_PASSWORD_BYTES = 72; // bcrypt учитывает только первые 72 байта
const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;

const invalidCredentials = () =>
  new AppError(Code.Unauthenticated, 'invalid email or password');
const invalidToken = () => new AppError(Code.Unauthenticated, 'invalid token');

@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);
  private readonly rounds: number;
  /** Сверяем пароль с фиктивным хешем, если email не найден: время ответа не выдаёт, есть ли аккаунт. */
  private readonly dummyHash: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsRepository,
    private readonly tokens: TokensService,
    config: AppConfig,
  ) {
    this.rounds = config.get('BCRYPT_ROUNDS');
    this.dummyHash = bcrypt.hashSync('dummy-password', this.rounds);
  }

  async register(
    rawEmail: string,
    password: string,
  ): Promise<{ id: string; email: string }> {
    const email = normalizeEmail(rawEmail);
    if (!EMAIL_RE.test(email)) {
      throw AppError.invalidInput('email is not valid');
    }
    const bytes = Buffer.byteLength(password);
    if (bytes < MIN_PASSWORD_LEN) {
      throw AppError.invalidInput(
        `password must be at least ${MIN_PASSWORD_LEN} characters`,
      );
    }
    if (bytes > MAX_PASSWORD_BYTES) {
      throw AppError.invalidInput(
        `password must be at most ${MAX_PASSWORD_BYTES} bytes`,
      );
    }

    const passwordHash = await bcrypt.hash(password, this.rounds);
    try {
      return await this.prisma.user.create({
        data: { id: randomUUID(), email, passwordHash },
        select: { id: true, email: true },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new AppError(Code.AlreadyExists, 'email already registered');
      }
      throw e;
    }
  }

  async login(rawEmail: string, password: string): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(rawEmail) },
      select: { id: true, passwordHash: true },
    });
    if (!user) {
      await bcrypt.compare(password, this.dummyHash);
      throw invalidCredentials();
    }
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      throw invalidCredentials();
    }
    return this.issue(user.id);
  }

  /** Ротация: старый refresh-токен гасится, выдаётся новая пара. */
  async refresh(refreshToken: string): Promise<TokenPair> {
    let userId: string, tokenId: string;
    try {
      ({ userId, tokenId } = await this.tokens.parseRefresh(refreshToken));
    } catch (e) {
      if (e instanceof InvalidTokenError) {
        this.log.debug(e.message);
        throw invalidToken();
      }
      throw e;
    }

    const stored = await this.sessions.consume(tokenId);
    if (stored === null) {
      this.log.debug('refresh token revoked or already used');
      throw invalidToken();
    }
    if (stored !== userId) {
      this.log.warn(`refresh session mismatch for jti ${tokenId}`);
      throw invalidToken();
    }
    return this.issue(userId);
  }

  private async issue(userId: string): Promise<TokenPair> {
    const { pair, refreshId } = await this.tokens.issue(userId);
    await this.sessions.save(refreshId, userId, this.tokens.refreshTtlSec);
    return pair;
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
