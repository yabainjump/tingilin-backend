import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { Transaction, TransactionSchema } from './schemas/transaction.schema';
import { TicketsModule } from '../tickets/tickets.module';
import { RafflesModule } from '../raffles/raffles.module';
import { ParticipationsModule } from '../participations/participations.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Transaction.name, schema: TransactionSchema },
    ]),
    TicketsModule,
    RafflesModule,
    ParticipationsModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
