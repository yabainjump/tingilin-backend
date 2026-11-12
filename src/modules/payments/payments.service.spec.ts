import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
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
  let txModelMock: Record<string, jest.Mock>;
  let digikuntzMock: {
    createDirectCharge: jest.Mock;
    getTransaction: jest.Mock;
    recoverPayin: jest.Mock;
    assertConfigured: jest.Mock;
    assertAccessible: jest.Mock;
  };

  beforeEach(async () => {
    txModelMock = {
      findById: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      exists: jest.fn(),
      updateOne: jest.fn(),
      updateMany: jest.fn(),
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
    digikuntzMock = {
      createDirectCharge: jest.fn(),
      getTransaction: jest.fn(),
      recoverPayin: jest.fn(),
      assertConfigured: jest.fn(),
      assertAccessible: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getModelToken(Transaction.name), useValue: txModelMock },
        { provide: getModelToken(LedgerEntry.name), useValue: ledgerModelMock },
        { provide: RafflesService, useValue: {} },
        { provide: TicketsService, useValue: {} },
        { provide: ParticipationsService, useValue: {} },
        { provide: DigikuntzPaymentsService, useValue: digikuntzMock },
        {
          provide: NotificationsService,
          useValue: { createOnce: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: UsersService, useValue: {} },
        { provide: ConfigService, useValue: configService },
        {
          provide: getConnectionToken(),
          useValue: { startSession: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('expires pending payments after the configured ten-minute deadline', async () => {
    const exec = jest.fn().mockResolvedValue({ modifiedCount: 3 });
    txModelMock.updateMany.mockReturnValue({ exec });
    const now = new Date('2026-11-11T12:00:00.000Z');

    await expect(service.expirePendingTransactions(now)).resolves.toBe(3);

    expect(txModelMock.updateMany).toHaveBeenCalledWith(
      {
        status: 'PENDING',
        $or: [
          { expiresAt: { $lte: now } },
          {
            expiresAt: { $exists: false },
            createdAt: { $lte: new Date('2026-11-11T11:50:00.000Z') },
          },
        ],
      },
      {
        $set: {
          status: 'FAILED',
          failReason: 'PAYMENT_EXPIRED',
          failedAt: now,
          rawProviderStatus: 'payment_expired',
        },
      },
    );
    expect(exec).toHaveBeenCalled();
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

  it('rechecks unsigned Digikuntz webhooks before trusting their status', async () => {
    configService.get.mockImplementation((key: string, fallback?: string) => {
      const values: Record<string, string> = {
        NODE_ENV: 'production',
        DIGIKUNTZ_WEBHOOK_SIGNATURE_MODE: 'provider-verify',
      };
      return values[key] ?? fallback;
    });

    const tx = {
      _id: { toString: () => '665f1a2b3c4d5e6f7a8b9c0d' },
      providerTransactionId: 'provider-id',
      providerRef: undefined,
      status: 'PENDING',
      rawProviderStatus: '',
      save: jest.fn().mockResolvedValue(undefined),
    };
    txModelMock.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(tx),
    });
    digikuntzMock.getTransaction.mockResolvedValue({
      id: 'provider-id',
      status: 'payin_pending',
      transactionRef: 'IN123#250101120000',
    });

    const result = await service.processDigikuntzWebhook({
      id: 'provider-id',
      status: 'payin_success',
      data: { transactionRef: 'IN123#250101120000' },
    });

    expect(digikuntzMock.getTransaction).toHaveBeenCalledWith('provider-id');
    expect(tx.rawProviderStatus).toBe('payin_pending');
    expect(tx.status).toBe('PENDING');
    expect(tx.save).toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, status: 'PENDING' });
  });

  it('reconciles a provider success received after local payment expiration', async () => {
    configService.get.mockImplementation((key: string, fallback?: string) => {
      const values: Record<string, string> = {
        NODE_ENV: 'production',
        DIGIKUNTZ_WEBHOOK_SIGNATURE_MODE: 'provider-verify',
      };
      return values[key] ?? fallback;
    });

    const tx = {
      _id: { toString: () => '665f1a2b3c4d5e6f7a8b9c0d' },
      userId: { toString: () => 'user-id' },
      raffleId: { toString: () => 'raffle-id' },
      providerTransactionId: 'provider-id',
      providerRef: 'PROVIDER-REF',
      amount: 5000,
      currency: 'XAF',
      quantity: 1,
      status: 'FAILED',
      failReason: 'PAYMENT_EXPIRED',
      rawProviderStatus: 'payment_expired',
      save: jest.fn().mockResolvedValue(undefined),
    };
    txModelMock.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(tx),
    });
    digikuntzMock.getTransaction.mockResolvedValue({
      id: 'provider-id',
      status: 'payin_success',
      transactionRef: 'PROVIDER-REF',
      estimation: 5000,
      receiverCurrency: 'XAF',
    });
    const finalize = jest
      .spyOn(service as any, 'finalizeSuccessfulTransaction')
      .mockResolvedValue({
        _id: { toString: () => '665f1a2b3c4d5e6f7a8b9c0d' },
        status: 'SUCCESS',
      });

    const result = await service.processDigikuntzWebhook({
      id: 'provider-id',
      status: 'payin_success',
    });

    expect(finalize).toHaveBeenCalledWith('665f1a2b3c4d5e6f7a8b9c0d');
    expect(result).toMatchObject({ ok: true, status: 'SUCCESS' });
  });

  it('repairs an incomplete idempotent intent from the Digikuntz transaction list', async () => {
    const tx = {
      _id: { toString: () => '665f1a2b3c4d5e6f7a8b9c0d' },
      provider: 'DIGIKUNTZ',
      amount: 100,
      currency: 'XAF',
      quantity: 1,
      status: 'PENDING',
      paymentLink: undefined,
      save: jest.fn().mockResolvedValue(undefined),
    };
    digikuntzMock.recoverPayin.mockResolvedValue({
      id: 'provider-id',
      status: 'payin_pending',
      transactionRef: 'RECOVER-REF',
      paymentWithTaxes: '105',
      paymentLink: 'https://checkout.example.com/pay/recovered',
    });

    const result = await (service as any).recoverIncompleteDigikuntzIntent(
      tx,
      100,
    );

    expect(digikuntzMock.recoverPayin).toHaveBeenCalledWith({
      amount: 100,
      reason: 'Tingilin payment 7A8B9C0D x1',
    });
    expect(tx).toMatchObject({
      providerTransactionId: 'provider-id',
      providerRef: 'RECOVER-REF',
      paymentLink: 'https://checkout.example.com/pay/recovered',
      paymentWithTaxes: 105,
      rawProviderStatus: 'payin_pending',
    });
    expect(tx.save).toHaveBeenCalled();
    expect(result).toMatchObject({
      paymentLink: 'https://checkout.example.com/pay/recovered',
      idempotent: true,
    });
  });

  it('repairs a direct-charge intent even when no checkout link exists', async () => {
    const tx = {
      _id: { toString: () => '665f1a2b3c4d5e6f7a8b9c0d' },
      provider: 'DIGIKUNTZ',
      amount: 5000,
      currency: 'XAF',
      quantity: 1,
      status: 'PENDING',
      paymentMethodCode: 'MTN',
      paymentLink: undefined,
      save: jest.fn().mockResolvedValue(undefined),
    };
    digikuntzMock.recoverPayin.mockResolvedValue({
      id: 'direct-provider-id',
      status: 'payin_pending',
      transactionRef: 'DIRECT-REF',
      paymentWithTaxes: '5250',
    });

    const result = await (service as any).recoverIncompleteDigikuntzIntent(
      tx,
      5000,
    );

    expect(tx).toMatchObject({
      providerTransactionId: 'direct-provider-id',
      providerRef: 'DIRECT-REF',
      paymentWithTaxes: 5250,
      rawProviderStatus: 'payin_pending',
    });
    expect(result).toMatchObject({
      paymentFlow: 'DIRECT_CHARGE',
      paymentMethodCode: 'MTN',
      idempotent: true,
    });
  });

  it.each([
    ['691224472', '237691224472'],
    ['+237 691 224 472', '237691224472'],
    ['00237-691-224-472', '237691224472'],
    ['1234', ''],
  ])('normalizes Cameroon phone %s', (input, expected) => {
    expect((service as any).normalizePhone(input)).toBe(expected);
  });

  it.each([
    ['ORANGE', 'ORANGEMONEY'],
    ['MTN', 'MTN'],
  ])('maps UI payment method %s to Digikuntz code %s', (input, expected) => {
    expect((service as any).digikuntzPaymentMethodCode(input)).toBe(expected);
  });
});
