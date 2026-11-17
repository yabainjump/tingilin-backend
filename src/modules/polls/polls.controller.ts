import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PollsService } from './polls.service';
import { VotePollDto } from './dto/poll.dto';

@ApiTags('Polls')
@Controller('polls')
export class PollsController {
  constructor(private readonly pollsService: PollsService) {}

  // Public: affiche le sondage et ses resultats agreges (aucun votant expose).
  @Get('active')
  active() {
    return this.pollsService.getActive();
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @Get('active/me')
  myVote(@Req() req: any) {
    return this.pollsService.getMyVote(req.user.sub);
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':id/vote')
  @HttpCode(200)
  vote(@Param('id') id: string, @Body() dto: VotePollDto, @Req() req: any) {
    return this.pollsService.vote(id, req.user.sub, dto.optionId);
  }
}
