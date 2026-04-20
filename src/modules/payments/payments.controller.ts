import {
  Body,
  Controller,
  HttpException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CreateIntentDto } from './dto/create-intent.dto';
import { MockConfirmDto } from './dto/mock-confirm.dto';
import { PaymentsService } from './payments.service';

import { MockFailDto } from './dto/mock-fail.dto';
import { DigikuntzVerifyDto } from './dto/digikuntz-verify.dto';
import { CreateFreeTicketDto } from './dto/create-free-ticket.dto';

@ApiTags('Payments')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard('jwt'))
@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('intent')
  async createIntent(@Req() req: any, @Body() dto: CreateIntentDto) {
    try {
      return await this.paymentsService.createIntent(req.user.sub, dto);
    } catch (error: any) {
      if (error instanceof HttpException) throw error;

      const message = String(error?.message ?? 'Unknown error').slice(0, 240);
      this.logger.error(
        `createIntent unexpected failure for user=${String(req?.user?.sub ?? '')}: ${message}`,
        error?.stack,
      );
      throw new InternalServerErrorException(`PAYMENT_INTENT_FAILED: ${message}`);
    }
  }

  @Post('mock/confirm')
  mockConfirm(@Req() req: any, @Body() dto: MockConfirmDto) {
    if (!this.paymentsService.mockPaymentsEnabled()) {
      throw new NotFoundException();
    }
    return this.paymentsService.mockConfirm(req.user.sub, dto);
  }

  @Post('mock/fail')
  mockFail(@Req() req: any, @Body() dto: MockFailDto) {
    if (!this.paymentsService.mockPaymentsEnabled()) {
      throw new NotFoundException();
    }
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
