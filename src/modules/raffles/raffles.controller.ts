import { Controller, Get, Param } from '@nestjs/common';
import { RafflesService } from './raffles.service';

@Controller('raffles')
export class RafflesController {
  constructor(private readonly rafflesService: RafflesService) {}

  @Get()
  list() {
    return this.rafflesService.listPublic();
  }

  @Get(':id/winner')
  async winner(@Param('id') id: string) {
    const r = await this.rafflesService.getPublicById(id);
    return {
      raffleId: r._id.toString(),
      status: r.status,
      winnerUserId: r.winnerUserId?.toString() ?? null,
      winnerTicketId: r.winnerTicketId?.toString() ?? null,
      drawnAt: r.drawnAt ?? null,
    };
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.rafflesService.getPublicById(id);
  }

  @Get(':id/stats')
  stats(@Param('id') id: string) {
    return this.rafflesService.getStats(id);
  }
}
