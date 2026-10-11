import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ParticipationsService } from './participations.service';

@ApiTags('Participations')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard('jwt'))
@Controller('participations')
export class ParticipationsController {
  constructor(private readonly participationsService: ParticipationsService) {}

  @Get('me/overview')
  myOverview(@Req() req: any) {
    return this.participationsService.myOverview(req.user.sub);
  }
}
