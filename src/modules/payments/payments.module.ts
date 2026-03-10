import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { Transaction, TransactionSchema } from './schemas/transaction.schema';
import { LedgerEntry, LedgerEntrySchema } from './schemas/ledger-entry.schema';
import { TicketsModule } from '../tickets/tickets.module';
import { RafflesModule } from '../raffles/raffles.module';
import { ParticipationsModule } from '../participations/participations.module';
import { HttpModule } from '@nestjs/axios';
import { DigikuntzPaymentsService } from './providers/digikuntz-payments.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { PaymentsAdminController } from './payments.admin.controller';
import { PaymentsWebhookController } from './payments.webhook.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Transaction.name, schema: TransactionSchema },
      { name: LedgerEntry.name, schema: LedgerEntrySchema },
    ]),
    TicketsModule,
    RafflesModule,
    NotificationsModule,
    ConfigModule,
    HttpModule,
    ParticipationsModule,
    UsersModule,
  ],
  controllers: [
    PaymentsController,
    PaymentsAdminController,
    PaymentsWebhookController,
  ],
  providers: [PaymentsService, DigikuntzPaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
