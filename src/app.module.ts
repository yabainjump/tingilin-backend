import { Logger, Module, OnModuleInit } from '@nestjs/common';
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
import { ConfigService } from '@nestjs/config';
import {
  assertRuntimeSecurityConfig,
  parseBooleanFlag,
} from './common/config/runtime-security';

const customDnsServers = String(process.env.DNS_SERVERS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const mongoLogger = new Logger('MongoDB');

if (customDnsServers.length > 0) {
  try {
    setDnsServers(customDnsServers);
  } catch {
    // Ignore invalid DNS config and keep system resolver.
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const parseInteger = (value: string | undefined, fallback: number) => {
          const parsed = Number(value);
          return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
        };
        const parseIpFamily = (value: string | undefined): 4 | 6 | undefined => {
          const normalized = String(value ?? '').trim();
          if (normalized === '4') return 4;
          if (normalized === '6') return 6;
          return undefined;
        };

        return {
          uri: String(config.get<string>('MONGO_URI') ?? '').trim(),
          serverSelectionTimeoutMS: parseInteger(
            config.get<string>('MONGO_SERVER_SELECTION_TIMEOUT_MS'),
            10000,
          ),
          connectTimeoutMS: parseInteger(
            config.get<string>('MONGO_CONNECT_TIMEOUT_MS'),
            10000,
          ),
          socketTimeoutMS: parseInteger(
            config.get<string>('MONGO_SOCKET_TIMEOUT_MS'),
            45000,
          ),
          heartbeatFrequencyMS: parseInteger(
            config.get<string>('MONGO_HEARTBEAT_FREQUENCY_MS'),
            10000,
          ),
          maxPoolSize: parseInteger(config.get<string>('MONGO_MAX_POOL_SIZE'), 20),
          minPoolSize: parseInteger(config.get<string>('MONGO_MIN_POOL_SIZE'), 1),
          retryWrites: parseBooleanFlag(
            String(config.get<string>('MONGO_RETRY_WRITES') ?? 'true'),
            true,
          ),
          ...(parseIpFamily(config.get<string>('MONGO_IP_FAMILY')) !== undefined
            ? { family: parseIpFamily(config.get<string>('MONGO_IP_FAMILY')) }
            : {}),
          connectionFactory: (connection: any) => {
            connection.on('connected', () => {
              mongoLogger.log('MongoDB connected');
            });
            connection.on('reconnected', () => {
              mongoLogger.log('MongoDB reconnected');
            });
            connection.on('disconnected', () => {
              mongoLogger.warn('MongoDB disconnected');
            });
            connection.on('error', (error: unknown) => {
              const message =
                error instanceof Error ? error.message : String(error ?? 'Unknown MongoDB error');
              mongoLogger.error(message);
            });
            return connection;
          },
        };
      },
    }),
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
export class AppModule implements OnModuleInit {
  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    assertRuntimeSecurityConfig(this.config);
  }
}
