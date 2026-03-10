import { Body, Controller, Headers, Post } from '@nestjs/common';
import { PaymentsService } from './payments.service';

@Controller('payments/digikuntz')
export class PaymentsWebhookController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('webhook')
  webhook(
    @Body()
    body: {
      transactionId?: string;
      providerTransactionId?: string;
      providerRef?: string;
      status?: string;
      failReason?: string;
    },
    @Headers('x-digikuntz-signature') signature?: string,
  ) {
    return this.paymentsService.processDigikuntzWebhook(body, signature);
  }
}
