import {
  Controller,
  Get,
  Body,
  Post,
  UseGuards,
  Req,
  Query,
  Param,
} from '@nestjs/common';
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

  @Get('home')
  home() {
    return this.rafflesService.listForHome();
  }

  @Get('live')
  listLive() {
    return this.rafflesPublicService.listLive(); // ou rafflesService.listLivePublic()
  }

  @Get('public')
  async listPublic(
    @Query('limit') limit?: string,
    @Query('sort') sort?: 'endAt' | 'createdAt',
  ) {
    const n = Math.min(Math.max(parseInt(limit ?? '30', 10) || 30, 1), 100);
    const s = sort === 'endAt' ? 'endAt' : 'createdAt';
    return this.rafflesService.listPublic({ limit: n, sort: s });
  }

  @Post('admin/create-with-product')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  createWithProduct(@Body() dto: AdminCreateRaffleDto, @Req() req: any) {
    const userId = req.user?.sub || req.user?.id || req.user?.userId;
    return this.rafflesService.adminCreateRaffle(dto, userId);
  }

  @Get('public/:id')
  publicById(@Param('id') id: string) {
    return this.rafflesService.getPublicDetails(id);
  }
}
