import { Controller, Get, Body, Post, UseGuards, Req } from '@nestjs/common';
import { RafflesService } from './raffles.service';
import { RafflesPublicService } from './raffles.public.service';

import { AdminCreateRaffleDto } from './dto/admin-create-raffle.dto';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('raffles')
export class RafflesController {
  constructor(
    private readonly rafflesService: RafflesService,
    private readonly rafflesPublicService: RafflesPublicService,
  ) {}

  @Get()
  list() {
    return this.rafflesService.listPublic();
  }

  @Get('live')
  listLive() {
    return this.rafflesPublicService.listLive(); // ou rafflesService.listLivePublic()
  }

  @Post('admin/create-with-product')
  @UseGuards(JwtAuthGuard)
  async adminCreateWithProduct(
    @Body() dto: AdminCreateRaffleDto,
    @Req() req: any,
  ) {
    const userId = req.user?.sub ?? req.user?.id ?? req.user?._id;
    return this.rafflesService.adminCreateRaffle(dto, String(userId));
  }
}
