import { Module } from '@nestjs/common';
import { ShareController } from './share.controller';
import { RafflesModule } from '../raffles/raffles.module';
import { Raffle, RaffleSchema } from '../raffles/schemas/raffle.schema';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/schemas/user.schema';

@Module({
  imports: [
    RafflesModule,
    MongooseModule.forFeature([
      { name: Raffle.name, schema: RaffleSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [ShareController],
})
export class ShareModule {}
