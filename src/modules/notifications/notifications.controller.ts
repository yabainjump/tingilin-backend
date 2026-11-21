import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Patch,
  Param,
  Query,
  Req,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { PushService } from './push.service';
import { RegisterDeviceDto, UnregisterDeviceDto } from './dto/device-token.dto';
import { Throttle } from '@nestjs/throttler';

// ⚠️ Mets EXACTEMENT le même import que dans payments/tickets controller
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Notifications')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard) // ✅ ICI (au-dessus de @Controller)
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifs: NotificationsService,
    private readonly push: PushService,
  ) {}

  // ---- Jetons push du telephone (FCM) ------------------------------------
  @Post('devices')
  @HttpCode(204)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async registerDevice(@Req() req: any, @Body() dto: RegisterDeviceDto) {
    const userId = req.user?.sub || req.user?.userId || req.user?._id;
    if (!userId) throw new UnauthorizedException();
    await this.push.registerDevice(String(userId), dto.token, dto.platform);
  }

  @Post('devices/unregister')
  @HttpCode(204)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async unregisterDevice(@Req() req: any, @Body() dto: UnregisterDeviceDto) {
    const userId = req.user?.sub || req.user?.userId || req.user?._id;
    if (!userId) throw new UnauthorizedException();
    await this.push.unregisterDevice(String(userId), dto.token);
  }

  @Get('me')
  my(
    @Req() req: any,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const userId = req.user?.sub || req.user?.userId || req.user?._id;
    if (!userId) throw new UnauthorizedException();

    return this.notifs.myNotifications(String(userId), {
      unreadOnly: unreadOnly === '1' || unreadOnly === 'true',
      page: Number(page || 1),
      limit: Number(limit || 20),
    });
  }

  @Get('unread-count')
  async unread(@Req() req: any) {
    const userId = req.user?.sub || req.user?.userId || req.user?._id;
    if (!userId) throw new UnauthorizedException();

    const count = await this.notifs.unreadCount(String(userId));
    return { count };
  }

  @Patch(':id/read')
  readOne(@Req() req: any, @Param('id') id: string) {
    const userId = req.user?.sub || req.user?.userId || req.user?._id;
    if (!userId) throw new UnauthorizedException();

    return this.notifs.markRead(String(userId), id);
  }

  @Patch('read-all')
  readAll(@Req() req: any) {
    const userId = req.user?.sub || req.user?.userId || req.user?._id;
    if (!userId) throw new UnauthorizedException();

    return this.notifs.markAllRead(String(userId));
  }
}
