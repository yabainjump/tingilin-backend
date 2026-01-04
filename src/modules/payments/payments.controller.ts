import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CreateIntentDto } from './dto/create-intent.dto';
import { MockConfirmDto } from './dto/mock-confirm.dto';
import { PaymentsService } from './payments.service';

@UseGuards(AuthGuard('jwt'))
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('intent')
  createIntent(@Req() req: any, @Body() dto: CreateIntentDto) {
    return this.paymentsService.createIntent(req.user.sub, dto);
  }

  // DEV only
  @Post('mock/confirm')
  mockConfirm(@Req() req: any, @Body() dto: MockConfirmDto) {
    return this.paymentsService.mockConfirm(req.user.sub, dto);
  }
}
