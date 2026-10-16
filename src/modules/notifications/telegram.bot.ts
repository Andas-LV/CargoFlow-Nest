import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { GrammyError, type Bot, type Context } from 'grammy';
import { REPLY } from './locale.ru';
import { NotificationsService } from './notifications.service';
import { TelegramClient } from './telegram.client';

const RETRY_DELAY_MS = 5000;

/** "/start@CargoFlowBot abc" → ["/start", "abc"]. */
export function parseCommand(text: string): [cmd: string, arg: string] {
  const trimmed = text.trim();
  const space = trimmed.indexOf(' ');
  const head = space < 0 ? trimmed : trimmed.slice(0, space);
  const arg = space < 0 ? '' : trimmed.slice(space + 1).trim();
  return [head.split('@')[0].toLowerCase(), arg];
}

/**
 * Long polling grammY. Вести его может только один инстанс: второй получит 409 от Telegram.
 */
@Injectable()
export class TelegramBot
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly log = new Logger(TelegramBot.name);
  private stopping = false;
  private retryTimer?: NodeJS.Timeout;

  constructor(
    private readonly telegram: TelegramClient,
    private readonly notifications: NotificationsService,
  ) {}

  onApplicationBootstrap(): void {
    const bot = this.telegram.instance;
    if (!bot) return;
    bot.on('message', (ctx) => this.handle(ctx));
    bot.catch((err) => this.log.error(`bot handler: ${err.message}`));
    this.poll(bot);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    clearTimeout(this.retryTimer);
    const bot = this.telegram.instance;
    if (bot?.isRunning()) await bot.stop();
  }

  private poll(bot: Bot): void {
    bot
      .start({ onStart: () => this.log.log('telegram long polling started') })
      .catch((e: unknown) => {
        if (this.stopping) return;
        if (e instanceof GrammyError && e.error_code === 409) {
          this.log.error(
            'telegram polling conflict: another bot instance or a webhook is active',
          );
        } else {
          this.log.warn(`telegram polling: ${(e as Error).message}`);
        }
        this.retryTimer = setTimeout(() => this.poll(bot), RETRY_DELAY_MS);
      });
  }

  private async handle(ctx: Context): Promise<void> {
    const msg = ctx.message;
    if (!msg || msg.chat.type !== 'private') return;

    const chatId = msg.chat.id;
    const [cmd, arg] = parseCommand(msg.text ?? '');
    let reply: string;
    try {
      if (cmd === '/start') {
        reply = await this.notifications.handleStart(chatId, arg);
      } else if (cmd === '/stop') {
        reply = await this.notifications.handleStop(chatId);
      } else {
        reply = REPLY.help;
      }
    } catch (e) {
      this.log.error(`handle bot command: ${(e as Error).message}`);
      reply = REPLY.internalFail;
    }

    try {
      await ctx.api.sendMessage(chatId, reply);
    } catch (e) {
      this.log.warn(`telegram reply: ${(e as Error).message}`);
    }
  }
}
