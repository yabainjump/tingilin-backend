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
import { ShareModule } from './modules/share/share.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ScheduleModule } from '@nestjs/schedule';
import { AuditModule } from './modules/audit/audit.module';
import { setServers as setDnsServers } from 'dns';

const customDnsServers = String(process.env.DNS_SERVERS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const dnsServers = customDnsServers.length
  ? customDnsServers
  : ['8.8.8.8', '1.1.1.1'];

try {
  setDnsServers(dnsServers);
} catch {
  // Ignore invalid DNS config and keep system resolver.
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRoot(process.env.MONGO_URI as string),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    UsersModule,
    AuthModule,
    ProductsModule,
    RafflesModule,
    TicketsModule,
    NotificationsModule,
    ShareModule,
    PaymentsModule,
    ParticipationsModule,
    ScheduleModule.forRoot(),
    AuditModule,
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
