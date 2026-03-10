import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RafflesController } from './raffles.controller';
import { RafflesService } from './raffles.service';
import { Raffle, RaffleSchema } from './schemas/raffle.schema';
import { RafflesAdminController } from './raffles.admin.controller';
import { ProductsModule } from '../products/products.module';
import { Ticket, TicketSchema } from '../tickets/schemas/ticket.schema';
import { TicketsModule } from '../tickets/tickets.module';
import { Product, ProductSchema } from '../products/schemas/product.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { RafflesPublicController } from './raffles.public.controller';
import { RafflesPublicService } from './raffles.public.service';
import { RafflesScheduler } from './raffles.sheduler';
import { NotificationsModule } from '../notifications/notifications.module';
import { RafflesLiveGateway } from './raffles.live.gateway';
import { AuditModule } from '../audit/audit.module';
import {
  Transaction,
  TransactionSchema,
} from '../payments/schemas/transaction.schema';
import {
  Participation,
  ParticipationSchema,
} from '../participations/schemas/participation.schema';

@Module({
  imports: [
    ProductsModule,
    TicketsModule,
    NotificationsModule,
    AuditModule,
    MongooseModule.forFeature([
      { name: Raffle.name, schema: RaffleSchema },
      { name: Ticket.name, schema: TicketSchema },
      { name: Product.name, schema: ProductSchema },
      { name: User.name, schema: UserSchema },
      { name: Transaction.name, schema: TransactionSchema },
      { name: Participation.name, schema: ParticipationSchema },
    ]),
  ],
  controllers: [
    RafflesController,
    RafflesAdminController,
    RafflesPublicController,
  ],
  providers: [
    RafflesService,
    RafflesPublicService,
    RafflesScheduler,
    RafflesLiveGateway,
  ],
  exports: [RafflesService],
})
export class RafflesModule {}
