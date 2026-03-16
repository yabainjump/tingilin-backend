import { Body, Controller, Headers, Post } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { DigikuntzWebhookDto } from './dto/digikuntz-webhook.dto';

@ApiTags('Payments Webhooks')
@ApiSecurity('digikuntz-signature')
@Controller('payments/digikuntz')
export class PaymentsWebhookController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('webhook')
  webhook(
    @Body() body: DigikuntzWebhookDto,
    @Headers('x-digikuntz-signature') signature?: string,
  ) {
    return this.paymentsService.processDigikuntzWebhook(body, signature);
  }
}
