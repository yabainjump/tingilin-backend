import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CreateIntentDto } from './dto/create-intent.dto';
import { MockConfirmDto } from './dto/mock-confirm.dto';
import { PaymentsService } from './payments.service';

import { MockFailDto } from './dto/mock-fail.dto';
import { DigikuntzVerifyDto } from './dto/digikuntz-verify.dto';
import { CreateFreeTicketDto } from './dto/create-free-ticket.dto';

@UseGuards(AuthGuard('jwt'))
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('intent')
  createIntent(@Req() req: any, @Body() dto: CreateIntentDto) {
    return this.paymentsService.createIntent(req.user.sub, dto);
  }

  @Post('mock/confirm')
  mockConfirm(@Req() req: any, @Body() dto: MockConfirmDto) {
    return this.paymentsService.mockConfirm(req.user.sub, dto);
  }

  @Post('mock/fail')
  mockFail(@Req() req: any, @Body() dto: MockFailDto) {
    return this.paymentsService.mockFail(req.user.sub, dto);
  }

  @Post('digikuntz/verify')
  digikuntzVerify(@Req() req: any, @Body() dto: DigikuntzVerifyDto) {
    return this.paymentsService.digikuntzVerify(req.user.sub, dto);
  }

  @Post('free-ticket')
  useFreeTicket(@Req() req: any, @Body() dto: CreateFreeTicketDto) {
    return this.paymentsService.useFreeTicket(req.user.sub, dto);
  }
}
