import { Controller, Get, Patch, Param, Query, Req } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifs: NotificationsService) {}

  @Get('me')
  my(
    @Req() req: any,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const userId = req.user.sub;
    return this.notifs.myNotifications(userId, {
      unreadOnly: unreadOnly === '1' || unreadOnly === 'true',
      page: Number(page || 1),
      limit: Number(limit || 20),
    });
  }

  @Get('unread-count')
  async unread(@Req() req: any) {
    const userId = req.user.sub;
    const count = await this.notifs.unreadCount(userId);
    return { count };
  }

  @Patch(':id/read')
  readOne(@Req() req: any, @Param('id') id: string) {
    const userId = req.user.sub;
    return this.notifs.markRead(userId, id);
  }

  @Patch('read-all')
  readAll(@Req() req: any) {
    const userId = req.user.sub;
    return this.notifs.markAllRead(userId);
  }
}
