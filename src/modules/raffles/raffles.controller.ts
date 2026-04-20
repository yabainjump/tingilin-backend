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
import { ApiTags } from '@nestjs/swagger';
import { RafflesService } from './raffles.service';
import { RafflesPublicService } from './raffles.public.service';

import { AdminCreateRaffleDto } from './dto/admin-create-raffle.dto';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('Raffles')
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

  @Get('home-feed')
  homeFeed(@Query('category') category?: string) {
    return this.rafflesService.getHomeFeed({ category });
  }

  @Get('live')
  listLive() {
    return this.rafflesPublicService.listLive(); 
  }

  @Get('public')
  async listPublic(
    @Query('limit') limit?: string,
    @Query('sort') sort?: 'endAt' | 'createdAt',
    @Query('category') category?: string,
  ) {
    const n = Math.min(Math.max(parseInt(limit ?? '30', 10) || 30, 1), 100);
    const s = sort === 'endAt' ? 'endAt' : 'createdAt';
    return this.rafflesService.listPublic({ limit: n, sort: s, category });
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

  @Get('winners')
  async winners(@Query('limit') limit?: string) {
    const n = Math.min(Math.max(parseInt(limit ?? '20', 10) || 20, 1), 100);
    return this.rafflesService.listWinnersPublic(n);
  }

  @Get(':id/winner')
  getWinner(@Param('id') id: string) {
    return this.rafflesService.getWinnerPublic(id);
  }

  @Get('winners/list')
  listWinners(@Query('limit') limit?: string) {
    return this.rafflesService.listWinnersPublic(Number(limit) || 10);
  }
}
