import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { Transaction, TransactionSchema } from './schemas/transaction.schema';
import { TicketsModule } from '../tickets/tickets.module';
import { RafflesModule } from '../raffles/raffles.module';
import { ParticipationsModule } from '../participations/participations.module';
import { HttpModule } from '@nestjs/axios';
import { DigikuntzPaymentsService } from './providers/digikuntz-payments.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Transaction.name, schema: TransactionSchema },
    ]),
    TicketsModule,
    RafflesModule,
    NotificationsModule,
    HttpModule,
    ParticipationsModule,
    UsersModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService, DigikuntzPaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
