import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import {
  ensurePaymentIndexes,
  ensureTicketFulfillmentIndex,
} from './payment-indexes';

@Injectable()
export class PaymentIndexesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PaymentIndexesService.name);

  constructor(@InjectConnection() private readonly connection: Connection) {}

  async onApplicationBootstrap(): Promise<void> {
    const collection = this.connection.collection('transactions');
    await ensurePaymentIndexes(collection, (message) =>
      this.logger.log(message),
    );
    await ensureTicketFulfillmentIndex(
      this.connection.collection('tickets'),
      (message) => this.logger.log(message),
    );
  }
}
