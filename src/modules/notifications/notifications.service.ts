import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AppError, Code } from '../../common/errors/app-error';
import { isUuid } from '../../common/uuid';
import { AppConfig } from '../../config/app-config.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { LinkCodesRepository } from './link-codes.repository';
import { REPLY } from './locale.ru';
import { TelegramClient } from './telegram.client';

@Injectable()
export class NotificationsService {
  private readonly linkTtlSec: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly codes: LinkCodesRepository,
    private readonly telegram: TelegramClient,
    config: AppConfig,
  ) {
    this.linkTtlSec = config.get('TELEGRAM_LINK_TTL_SEC');
  }

  /** Одноразовая deep-ссылка для привязки чата. */
  async createLink(userId: string): Promise<{ url: string; expiresAt: Date }> {
    const username = this.telegram.username;
    if (!username) {
      throw new AppError(
        Code.FailedPrecondition,
        'telegram notifications are not configured',
      );
    }
    const code = randomBytes(12).toString('base64url'); // 16 символов
    await this.codes.save(code, userId, this.linkTtlSec);
    return {
      url: `https://t.me/${username}?start=${code}`,
      expiresAt: new Date(Date.now() + this.linkTtlSec * 1000),
    };
  }

  async status(
    userId: string,
  ): Promise<{ linked: boolean; linkedAt: Date | null }> {
    const link = await this.prisma.telegramLink.findUnique({
      where: { userId },
    });
    return { linked: link !== null, linkedAt: link?.linkedAt ?? null };
  }

  /** Отвязка; если привязки не было, это не ошибка. */
  async unlink(userId: string): Promise<void> {
    await this.prisma.telegramLink.deleteMany({ where: { userId } });
  }

  /** Чат владельца для уведомлений; null — Telegram не привязан. */
  async chatId(userId: string): Promise<bigint | null> {
    if (!isUuid(userId)) return null; // событие без валидного владельца не доставить
    const link = await this.prisma.telegramLink.findUnique({
      where: { userId: userId.toLowerCase() },
    });
    return link?.chatId ?? null;
  }

  /** /start <code> в боте. */
  async handleStart(chatId: number, code: string): Promise<string> {
    if (!code) return REPLY.noCode;
    const userId = await this.codes.consume(code);
    if (userId === null) return REPLY.badCode;
    if (!isUuid(userId)) {
      throw new Error(`bad user id in link code: ${userId}`);
    }
    await this.prisma.telegramLink.upsert({
      where: { userId },
      create: { userId, chatId: BigInt(chatId) },
      update: { chatId: BigInt(chatId), linkedAt: new Date() },
    });
    return REPLY.linked;
  }

  /** /stop в боте: удаляет все привязки этого чата. */
  async handleStop(chatId: number): Promise<string> {
    const { count } = await this.prisma.telegramLink.deleteMany({
      where: { chatId: BigInt(chatId) },
    });
    return count === 0 ? REPLY.notLinked : REPLY.unlinked;
  }
}
