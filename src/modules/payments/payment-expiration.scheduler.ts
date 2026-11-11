import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PaymentsService } from './payments.service';

@Injectable()
export class PaymentExpirationScheduler {
  private readonly logger = new Logger(PaymentExpirationScheduler.name);
  private running = false;

  constructor(private readonly paymentsService: PaymentsService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async expireStalePayments(): Promise<void> {
    if (this.running) return;

    this.running = true;
    try {
      const expired = await this.paymentsService.expirePendingTransactions();
      if (expired > 0) {
        this.logger.log(`Expired ${expired} stale pending payment(s)`);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? 'Unknown error');
      this.logger.error(`Pending payment expiration failed: ${message}`);
    } finally {
      this.running = false;
    }
  }
}
