import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RafflesPublicService } from './raffles.public.service';
import { RafflesService } from './raffles.service';

@ApiTags('Raffles')
@Controller('raffles')
export class RafflesPublicController {
  constructor(
    private readonly rafflesPublicService: RafflesPublicService,
    private readonly rafflesService: RafflesService,
  ) {}

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

  // GET /api/v1/raffles/:id/fairness
  @Get(':id/fairness')
  @ApiOperation({
    summary:
      'Preuve verifiable du tirage (commit-reveal). Engagement avant tirage, ' +
      'seed revele + donnees recalculables apres tirage.',
  })
  getFairness(@Param('id') id: string) {
    return this.rafflesService.getFairness(id);
  }
}
