import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: any) {
    return this.usersService.getMe(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/stats')
  stats(@Req() req: any) {
    return this.usersService.getMyStats(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/history')
  history(@Req() req: any, @Query('limit') limit?: string) {
    const n = Math.min(Math.max(parseInt(limit ?? '5', 10) || 5, 1), 50);
    return this.usersService.getMyHistory(req.user.sub, n);
  }
}
