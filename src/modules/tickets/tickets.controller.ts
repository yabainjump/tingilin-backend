import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TicketsService } from './tickets.service';

@UseGuards(AuthGuard('jwt'))
@Controller('tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get('me')
  myTickets(@Req() req: any, @Query('raffleId') raffleId?: string) {
    return this.ticketsService.listMyTickets(req.user.sub, raffleId);
  }
}
