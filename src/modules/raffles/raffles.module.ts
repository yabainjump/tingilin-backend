import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RafflesController } from './raffles.controller';
import { RafflesService } from './raffles.service';
import { Raffle, RaffleSchema } from './schemas/raffle.schema';
import { RafflesAdminController } from './raffles.admin.controller';
import { ProductsModule } from '../products/products.module';

@Module({
  imports: [
    ProductsModule,
    MongooseModule.forFeature([{ name: Raffle.name, schema: RaffleSchema }]),
  ],
  controllers: [RafflesController, RafflesAdminController],
  providers: [RafflesService],
  exports: [RafflesService],
})
export class RafflesModule {}
