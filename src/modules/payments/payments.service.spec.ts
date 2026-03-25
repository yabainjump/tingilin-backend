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
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
