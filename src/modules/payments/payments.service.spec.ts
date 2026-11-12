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

  describe('purchase fulfillment under concurrency', () => {
    const TX_ID = '665f1a2b3c4d5e6f7a8b9c0d';
    const RAFFLE_ID = '665f1a2b3c4d5e6f7a8b9c0f';
    let raffles: { incrementStats: jest.Mock };
    let participations: { upsertAfterPurchase: jest.Mock };
    let tickets: { createMany: jest.Mock };
    let users: { evaluateMilestones: jest.Mock };
    let session: { withTransaction: jest.Mock; endSession: jest.Mock };
    let txDoc: any;

    const chain = (value: unknown) => {
      const q: any = {
        exec: jest.fn().mockResolvedValue(value),
      };
      q.session = jest.fn().mockReturnValue(q);
      q.select = jest.fn().mockReturnValue(q);
      q.lean = jest.fn().mockReturnValue(q);
      return q;
    };

    beforeEach(() => {
      txDoc = {
        _id: { toString: () => TX_ID },
        userId: { toString: () => 'user-id' },
        raffleId: { toString: () => RAFFLE_ID },
        quantity: 3,
        amount: 1500,
        currency: 'XAF',
        provider: 'MOCK',
        status: 'PENDING',
        stockState: undefined as string | undefined,
        save: jest.fn().mockResolvedValue(undefined),
      };
      raffles = {
        incrementStats: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      };
      participations = {
        upsertAfterPurchase: jest
          .fn()
          .mockResolvedValue({ wasCreated: false, isFirstPurchase: true }),
      };
      tickets = { createMany: jest.fn().mockResolvedValue(undefined) };
      users = { evaluateMilestones: jest.fn().mockResolvedValue(undefined) };
      session = {
        withTransaction: jest.fn(async (fn: () => Promise<void>) => fn()),
        endSession: jest.fn().mockResolvedValue(undefined),
      };
      Object.assign(service as any, {
        rafflesService: raffles,
        participationsService: participations,
        ticketsService: tickets,
        usersService: users,
        connection: { startSession: jest.fn().mockResolvedValue(session) },
      });
      (service as any).ledgerModel.updateOne.mockReturnValue(chain(undefined));

      // findById sert a la lecture initiale et a la relecture dans la
      // transaction (apres reservation: stockState=RESERVED).
      txModelMock.findById.mockImplementation(() => chain(txDoc));
      txModelMock.findOneAndUpdate = jest.fn(() =>
        chain({ ...txDoc, stockState: 'CLAIMING' }),
      );
      txModelMock.updateOne.mockImplementation(
        (_filter: unknown, update: any) => {
          if (update?.$set?.stockState === 'RESERVED') {
            txDoc.stockState = 'RESERVED';
          }
          if (update?.$unset?.stockState) txDoc.stockState = undefined;
          return chain({ modifiedCount: 1 });
        },
      );
    });

    it('reserves raffle stock with one atomic update OUTSIDE the Mongo transaction', async () => {
      const result = await (service as any).finalizeSuccessfulTransaction(
        TX_ID,
      );

      expect(result.status).toBe('SUCCESS');
      // Reservation sans session: le document tombola n'est plus dans la transaction.
      expect(raffles.incrementStats).toHaveBeenNthCalledWith(
        1,
        RAFFLE_ID,
        3,
        0,
        undefined,
        true,
      );
      // Apres commit: nouveau participant (bug participantsCount=0 corrige).
      expect(raffles.incrementStats).toHaveBeenNthCalledWith(
        2,
        RAFFLE_ID,
        0,
        1,
      );
      expect(raffles.incrementStats).toHaveBeenCalledTimes(2);
      expect(tickets.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ transactionId: TX_ID, quantity: 3 }),
        session,
      );
      expect(txDoc.save).toHaveBeenCalledWith({ session });
    });

    it('gives the reserved stock back when the fulfillment transaction fails', async () => {
      session.withTransaction.mockRejectedValue(
        new Error('TransientTransactionError'),
      );

      await expect(
        (service as any).finalizeSuccessfulTransaction(TX_ID),
      ).rejects.toThrow('TransientTransactionError');

      expect(raffles.incrementStats).toHaveBeenNthCalledWith(
        1,
        RAFFLE_ID,
        3,
        0,
        undefined,
        true,
      );
      expect(raffles.incrementStats).toHaveBeenNthCalledWith(
        2,
        RAFFLE_ID,
        -3,
        0,
      );
      expect(txDoc.stockState).toBeUndefined();
    });

    it('does not reserve twice when the stock is already reserved (webhook + verify)', async () => {
      txDoc.stockState = 'RESERVED';

      await (service as any).finalizeSuccessfulTransaction(TX_ID);

      expect(txModelMock.findOneAndUpdate).not.toHaveBeenCalled();
      expect(raffles.incrementStats).toHaveBeenCalledTimes(1);
      expect(raffles.incrementStats).toHaveBeenCalledWith(RAFFLE_ID, 0, 1);
    });

    it('releases the claim and issues no ticket when the raffle is sold out', async () => {
      raffles.incrementStats.mockRejectedValueOnce(
        new Error('Raffle is closed or has no tickets left'),
      );

      await expect(
        (service as any).finalizeSuccessfulTransaction(TX_ID),
      ).rejects.toThrow('no tickets left');

      expect(session.withTransaction).not.toHaveBeenCalled();
      expect(tickets.createMany).not.toHaveBeenCalled();
      expect(txDoc.stockState).toBeUndefined();
    });
  });

  describe('Digikuntz direct charge', () => {
    it('rejects a payment method that does not match the phone operator before calling the provider', async () => {
      Object.assign(service as any, {
        rafflesService: {
          adminGetById: jest.fn().mockResolvedValue({
            status: 'LIVE',
            ticketPrice: 500,
            currency: 'XAF',
            totalTickets: 0,
            ticketsSold: 0,
          }),
        },
        usersService: {
          findById: jest.fn().mockResolvedValue({
            email: 'u@example.com',
            firstName: 'A',
            lastName: 'B',
          }),
        },
      });

      await expect(
        service.createIntent('665f1a2b3c4d5e6f7a8b9c0e', {
          raffleId: '665f1a2b3c4d5e6f7a8b9c0f',
          amount: 500,
          provider: 'DIGIKUNTZ',
          userPhone: '677123456', // numero MTN
          paymentMethodCode: 'ORANGE',
        } as any),
      ).rejects.toThrow(/numéro MTN Mobile Money/);

      expect(digikuntzMock.createDirectCharge).not.toHaveBeenCalled();
      expect(txModelMock.create).not.toHaveBeenCalled();
    });

    it('returns the hosted checkout link created after a refused direct charge', async () => {
      const link = 'https://checkout.flutterwave.com/v3/hosted/pay/flwlnk-XXXX';
      const tx = {
        _id: { toString: () => '665f1a2b3c4d5e6f7a8b9c0d' },
        userId: { toString: () => 'user-id' },
        provider: 'DIGIKUNTZ',
        providerTransactionId: '6af3b037d39740d6da4a0ce4',
        status: 'PENDING',
        paymentFlow: 'DIRECT_CHARGE',
        expiresAt: new Date(Date.now() + 5 * 60_000),
        save: jest.fn().mockResolvedValue(undefined),
      } as any;
      txModelMock.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(tx),
      });
      // Reponse documentee "responseWhenRefused" (deja normalisee par le provider)
      digikuntzMock.getTransaction.mockResolvedValue({
        id: '6af3b037d39740d6da4a0ce4',
        status: 'payin_pending',
        paymentLink: link,
        data: {
          chargeStatus: 'failed',
          fallback: { from: 'direct', reason: 'DIRECT_CHARGE_REFUSED' },
        },
      });

      const result = await service.digikuntzVerify('user-id', {
        transactionId: '665f1a2b3c4d5e6f7a8b9c0d',
      } as any);

      expect(result).toMatchObject({
        status: 'PENDING',
        paymentFlow: 'HOSTED_CHECKOUT',
        paymentLink: link,
      });
      expect(tx.paymentLink).toBe(link);
      expect(tx.save).toHaveBeenCalled();
    });
  });
});
