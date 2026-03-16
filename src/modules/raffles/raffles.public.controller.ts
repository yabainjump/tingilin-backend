import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RafflesPublicService } from './raffles.public.service';

@ApiTags('Raffles')
@Controller('raffles')
export class RafflesPublicController {
  constructor(private readonly rafflesPublicService: RafflesPublicService) {}

  // GET /api/v1/raffles/live
  @Get('live')
  listLive() {
    return this.rafflesPublicService.listLive();
  }

  // GET /api/v1/raffles/:id
  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.rafflesPublicService.getOne(id);
  }

  // GET /api/v1/raffles/:id/stats
  @Get(':id/stats')
  getStats(@Param('id') id: string) {
    return this.rafflesPublicService.getStats(id);
  }

  // GET /api/v1/raffles/:id/winner
  @Get(':id/winner')
  getWinner(@Param('id') id: string) {
    return this.rafflesPublicService.getWinner(id);
  }
}
