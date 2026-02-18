import {
  Body,
  Controller,
  Get,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UsersService } from './users.service';
import { UpdateMeDto } from './dto/update-me.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@Req() req: any) {
    const userId = req.user?.sub; // vient du token
    const user = await this.usersService.findById(userId);
    return this.usersService.toPublic(user);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  async updateMe(@Req() req: any, @Body() dto: UpdateMeDto) {
    const userId = req.user?.sub;
    const user = await this.usersService.updateMe(userId, dto);
    return this.usersService.toPublic(user);
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
