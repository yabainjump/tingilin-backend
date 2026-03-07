import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User, UserSchema } from './schemas/user.schema';
import { UsersAdminController } from './users.admin.controller';

import { Ticket, TicketSchema } from '../tickets/schemas/ticket.schema';
import { Raffle, RaffleSchema } from '../raffles/schemas/raffle.schema';
import { Product, ProductSchema } from '../products/schemas/product.schema';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    NotificationsModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Ticket.name, schema: TicketSchema },
      { name: Raffle.name, schema: RaffleSchema },
      { name: Product.name, schema: ProductSchema },
    ]),
  ],
  controllers: [UsersController, UsersAdminController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
