import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { PaymentsService } from './payments.service';
import { Transaction } from './schemas/transaction.schema';
import { RafflesService } from '../raffles/raffles.service';
import { TicketsService } from '../tickets/tickets.service';
import { ParticipationsService } from '../participations/participations.service';
import { DigikuntzPaymentsService } from './providers/digikuntz-payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';
import { LedgerEntry } from './schemas/ledger-entry.schema';
import { ConfigService } from '@nestjs/config';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    const txModelMock = {
      findById: jest.fn(),
      create: jest.fn(),
      exists: jest.fn(),
      updateOne: jest.fn(),
    };
    const ledgerModelMock = {
      find: jest.fn(),
      updateOne: jest.fn(),
      aggregate: jest.fn(),
    };

    configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          NODE_ENV: 'test',
          DIGIKUNTZ_WEBHOOK_SECRET: 'webhooksecret123456789012345',
          DIGIKUNTZ_WEBHOOK_SIGNATURE_MODE: 'legacy-static',
        };
        return values[key];
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getModelToken(Transaction.name), useValue: txModelMock },
        { provide: getModelToken(LedgerEntry.name), useValue: ledgerModelMock },
        { provide: RafflesService, useValue: {} },
        { provide: TicketsService, useValue: {} },
        { provide: ParticipationsService, useValue: {} },
        { provide: DigikuntzPaymentsService, useValue: {} },
        { provide: NotificationsService, useValue: {} },
        { provide: UsersService, useValue: {} },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('disables mock payments by default in production', () => {
    configService.get.mockImplementation((key: string) => {
      const values: Record<string, string> = {
        NODE_ENV: 'production',
        ENABLE_MOCK_PAYMENTS: '',
        DIGIKUNTZ_WEBHOOK_SECRET: 'webhooksecret123456789012345',
        DIGIKUNTZ_WEBHOOK_SIGNATURE_MODE: 'hmac',
      };
      return values[key];
    });

    expect(service.mockPaymentsEnabled()).toBe(false);
  });
});
