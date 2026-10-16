import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Bot } from 'grammy';
import { AppConfig } from '../../config/app-config.service';

/**
 * Клиент Telegram Bot API. Без TELEGRAM_BOT_TOKEN выключен: бот не запускается, уведомления
 * молча пропускаются, остальное API работает.
 */
@Injectable()
export class TelegramClient implements OnModuleInit {
  private readonly log = new Logger(TelegramClient.name);
  private bot: Bot | null = null;
  private botUsername = '';

  constructor(private readonly config: AppConfig) {}

  async onModuleInit(): Promise<void> {
    const token = this.config.get('TELEGRAM_BOT_TOKEN');
    if (!token) {
      this.log.log(
        'TELEGRAM_BOT_TOKEN is empty: telegram notifications are disabled',
      );
      return;
    }
    const bot = new Bot(token);
    try {
      await bot.init(); // getMe: нужен username для deep-ссылки
    } catch (e) {
      // API без Telegram продолжает работать; уведомления выключены до рестарта.
      this.log.error(
        `telegram getMe failed, notifications disabled: ${(e as Error).message}`,
      );
      return;
    }
    this.bot = bot;
    this.botUsername = bot.botInfo.username;
    this.log.log(`telegram bot @${this.botUsername} ready`);
  }

  get enabled(): boolean {
    return this.bot !== null;
  }

  /** Username бота; пустая строка, если Telegram не настроен. */
  get username(): string {
    return this.botUsername;
  }

  /** Экземпляр grammY для long polling; null, если Telegram не настроен. */
  get instance(): Bot | null {
    return this.bot;
  }

  async sendMessage(chatId: bigint | number, text: string): Promise<void> {
    if (!this.bot) throw new Error('telegram is not configured');
    await this.bot.api.sendMessage(Number(chatId), text);
  }
}
