import { Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import {
  EmptyResponse,
  TelegramLinkResponse,
  TelegramStatusResponse,
} from './notification.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('v1/notifications/telegram')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post('link')
  @HttpCode(200)
  createLink(@CurrentUser() userId: string): Promise<TelegramLinkResponse> {
    return this.notifications.createLink(userId);
  }

  @Get()
  status(@CurrentUser() userId: string): Promise<TelegramStatusResponse> {
    return this.notifications.status(userId);
  }

  @Delete()
  async unlink(@CurrentUser() userId: string): Promise<EmptyResponse> {
    await this.notifications.unlink(userId);
    return {};
  }
}
