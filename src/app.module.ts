import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProductsModule } from './modules/products/products.module';
import { RafflesModule } from './modules/raffles/raffles.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ParticipationsModule } from './modules/participations/participations.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRoot(process.env.MONGO_URI as string),
    ThrottlerModule.forRoot([
      { ttl: 60, limit: 20 }, // global default
    ]),
    UsersModule,
    AuthModule,
    ProductsModule,
    RafflesModule,
    TicketsModule,
    PaymentsModule,
    ParticipationsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
