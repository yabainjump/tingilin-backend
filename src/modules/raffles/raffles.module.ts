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
import { RafflesPublicController } from './raffles.public.controller';
import { RafflesPublicService } from './raffles.public.service';

@Module({
  imports: [
    ProductsModule,
    TicketsModule,
    MongooseModule.forFeature([
      { name: Raffle.name, schema: RaffleSchema },
      { name: Ticket.name, schema: TicketSchema },
      { name: Product.name, schema: ProductSchema },
    ]),
  ],
  controllers: [
    RafflesController,
    RafflesAdminController,
    RafflesPublicController,
  ],
  providers: [RafflesService, RafflesPublicService],
  exports: [RafflesService],
})
export class RafflesModule {}
