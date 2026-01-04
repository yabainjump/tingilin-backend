import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RafflesController } from './raffles.controller';
import { RafflesService } from './raffles.service';
import { Raffle, RaffleSchema } from './schemas/raffle.schema';
import { RafflesAdminController } from './raffles.admin.controller';
import { ProductsModule } from '../products/products.module';
import { Ticket, TicketSchema } from '../tickets/schemas/ticket.schema';
import { TicketsModule } from '../tickets/tickets.module';

@Module({
  imports: [
    ProductsModule,
    TicketsModule,
    MongooseModule.forFeature([
      { name: Raffle.name, schema: RaffleSchema },
      { name: Ticket.name, schema: TicketSchema },
    ]),
  ],
  controllers: [RafflesController, RafflesAdminController],
  providers: [RafflesService],
  exports: [RafflesService],
})
export class RafflesModule {}
