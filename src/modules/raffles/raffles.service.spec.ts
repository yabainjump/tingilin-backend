import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { RafflesService } from './raffles.service';
import { Raffle } from './schemas/raffle.schema';
import { Product } from '../products/schemas/product.schema';
import { Ticket } from '../tickets/schemas/ticket.schema';
import { User } from '../users/schemas/user.schema';
import { Transaction } from '../payments/schemas/transaction.schema';
import { Participation } from '../participations/schemas/participation.schema';
import { ProductsService } from '../products/products.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RaffleStatus } from './schemas/raffle.schema';
import { Types } from 'mongoose';
import { QueryCacheService } from '../../common/cache/query-cache.service';

describe('RafflesService', () => {
  let service: RafflesService;
  let raffleModelMock: any;
  let productModelMock: any;
  let ticketModelMock: any;
  let notificationsMock: any;
  let queryCacheMock: any;
  let connectionMock: any;

  beforeEach(async () => {
    const queryMock = {
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };

    raffleModelMock = {
      find: jest.fn().mockReturnValue(queryMock),
      findById: jest.fn(),
      countDocuments: jest.fn(),
      aggregate: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([]),
      }),
      findOneAndUpdate: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      updateOne: jest.fn(),
      create: jest.fn(),
    };

    productModelMock = {
      find: jest.fn(),
      findById: jest.fn(),
      countDocuments: jest.fn(),
      aggregate: jest.fn(),
      findOneAndUpdate: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      updateOne: jest.fn(),
      create: jest.fn(),
    };

    ticketModelMock = {
      find: jest.fn(),
      findById: jest.fn(),
      countDocuments: jest.fn(),
      aggregate: jest.fn(),
      distinct: jest.fn(),
      updateOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      create: jest.fn(),
    };

    const modelMock = {
      find: jest.fn(),
      findById: jest.fn(),
      countDocuments: jest.fn(),
      aggregate: jest.fn(),
      findOneAndUpdate: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      create: jest.fn(),
    };

    notificationsMock = {
      create: jest.fn(),
      createOnce: jest.fn(),
    };

    queryCacheMock = {
      remember: jest.fn(async (_key: string, load: () => Promise<unknown>) =>
        load(),
      ),
      invalidatePrefix: jest.fn().mockResolvedValue(undefined),
    };
    connectionMock = {
      startSession: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RafflesService,
        { provide: getModelToken(Raffle.name), useValue: raffleModelMock },
        { provide: getModelToken(Product.name), useValue: productModelMock },
        { provide: getModelToken(Ticket.name), useValue: ticketModelMock },
        { provide: getModelToken(User.name), useValue: modelMock },
        { provide: getModelToken(Transaction.name), useValue: modelMock },
        { provide: getModelToken(Participation.name), useValue: modelMock },
        { provide: ProductsService, useValue: {} },
        { provide: getConnectionToken(), useValue: connectionMock },
        { provide: NotificationsService, useValue: notificationsMock },
        { provide: QueryCacheService, useValue: queryCacheMock },
      ],
    }).compile();

    service = module.get<RafflesService>(RafflesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('listPublic(sort=endAt) should only query active LIVE raffles', async () => {
    await service.listPublic({ sort: 'endAt', limit: 10 });

    const pipeline = raffleModelMock.aggregate.mock.calls.at(-1)?.[0];
    expect(pipeline[0]).toEqual({
      $match: expect.objectContaining({
        status: RaffleStatus.LIVE,
        endAt: expect.objectContaining({ $gt: expect.any(Date) }),
        $or: expect.any(Array),
      }),
    });
  });

  it('listPublic(sort=createdAt) should include LIVE/CLOSED/DRAWN', async () => {
    await service.listPublic({ sort: 'createdAt', limit: 10 });

    const pipeline = raffleModelMock.aggregate.mock.calls.at(-1)?.[0];
    expect(pipeline[0]).toEqual({
      $match: expect.objectContaining({
        status: expect.objectContaining({
          $in: [RaffleStatus.LIVE, RaffleStatus.CLOSED, RaffleStatus.DRAWN],
        }),
      }),
    });
  });

  it('listPublic(category=all) should skip product category filtering', async () => {
    await service.listPublic({ sort: 'endAt', limit: 10, category: 'all' });

    const pipeline = raffleModelMock.aggregate.mock.calls.at(-1)?.[0];
    const productMatch = pipeline[3].$lookup.pipeline[0].$match;
    expect(productModelMock.find).not.toHaveBeenCalled();
    expect(productMatch.categoryId).toBeUndefined();
  });

  it('uses the public raffle status as visibility source of truth', async () => {
    await service.listPublic({ sort: 'createdAt', limit: 10 });

    const pipeline = raffleModelMock.aggregate.mock.calls.at(-1)?.[0];
    const productMatch = pipeline[3].$lookup.pipeline[0].$match;

    expect(productMatch).toEqual({
      $expr: { $eq: ['$_id', '$$productId'] },
    });
    expect(productMatch.status).toBeUndefined();
  });

  it('listWinnersPublic should resolve winners with one aggregation', async () => {
    const raffleId = new Types.ObjectId();
    raffleModelMock.aggregate.mockReturnValueOnce({
      exec: jest.fn().mockResolvedValue([
        {
          _id: raffleId,
          winner: { drawnAt: new Date('2026-01-01T00:00:00.000Z') },
          product: { title: 'Phone', imageUrl: '/uploads/phone.webp' },
          ticket: { serial: 'TGL-TEST-1234' },
          user: { username: 'winner' },
        },
      ]),
    });

    const result = await service.listWinnersPublic(10);

    expect(raffleModelMock.aggregate).toHaveBeenCalledTimes(1);
    expect(ticketModelMock.findById).not.toHaveBeenCalled();
    expect(result.data).toEqual([
      expect.objectContaining({
        raffleId: raffleId.toString(),
        winnerName: 'winner',
        prizeTitle: 'Phone',
        ticketCode: '1234',
      }),
    ]);
  });

  it('publishes the product when a raffle is created directly LIVE', async () => {
    const productId = new Types.ObjectId();
    const raffleId = new Types.ObjectId();
    const session = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      abortTransaction: jest.fn().mockResolvedValue(undefined),
      endSession: jest.fn(),
    };
    connectionMock.startSession.mockResolvedValue(session);
    productModelMock.create.mockResolvedValue([{ _id: productId }]);
    raffleModelMock.create.mockResolvedValue([{ _id: raffleId }]);

    await service.adminCreateRaffle(
      {
        publishNow: true,
        product: {
          title: 'Phone',
          imageUrl: '/uploads/products/phone.webp',
          categoryId: 'GENERAL',
        },
        raffle: {
          ticketPrice: 100,
          totalTickets: 100,
          currency: 'XAF',
          endAt: new Date(Date.now() + 86_400_000).toISOString(),
        },
      },
      new Types.ObjectId().toString(),
    );

    expect(productModelMock.create.mock.calls[0][0][0]).toEqual(
      expect.objectContaining({ status: 'PUBLISHED' }),
    );
    expect(raffleModelMock.create.mock.calls[0][0][0]).toEqual(
      expect.objectContaining({ status: RaffleStatus.LIVE }),
    );
    expect(queryCacheMock.invalidatePrefix).toHaveBeenCalledWith('raffles:');
  });

  it('publishes the product and invalidates public cache when reopening LIVE', async () => {
    const raffleId = new Types.ObjectId();
    const productId = new Types.ObjectId();
    const updated = {
      _id: raffleId,
      status: RaffleStatus.LIVE,
      productId: { _id: productId, title: 'Phone' },
      toObject: () => ({
        _id: raffleId,
        status: RaffleStatus.LIVE,
        productId: { _id: productId, title: 'Phone' },
      }),
    };
    raffleModelMock.findByIdAndUpdate.mockReturnValue({
      populate: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(updated),
      }),
    });
    productModelMock.updateOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    });

    await service.adminUpdate(raffleId.toString(), {
      status: RaffleStatus.LIVE,
      endAt: new Date(Date.now() + 86_400_000).toISOString(),
    });

    expect(productModelMock.updateOne).toHaveBeenCalledWith(
      { _id: productId },
      { $set: { status: 'PUBLISHED' } },
    );
    expect(queryCacheMock.invalidatePrefix).toHaveBeenCalledWith('raffles:');
  });

  it('drawWinner claims the draw atomically and records a verifiable proof', async () => {
    const raffleId = new Types.ObjectId();
    const winnerTicketId = new Types.ObjectId();
    const winnerUserId = new Types.ObjectId();
    const raffleDoc: any = {
      _id: raffleId,
      status: RaffleStatus.CLOSED,
      winner: null,
      save: jest.fn().mockResolvedValue(undefined),
    };

    // findById: drawWinner (.exec -> raffleDoc) + pickProvablyFairWinner
    // (.select.lean.exec -> seed engage).
    raffleModelMock.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(raffleDoc),
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            drawServerSeed: 'a'.repeat(64),
            drawCommitment: 'committed-hash',
          }),
        }),
      }),
    });

    // Ensemble ordonne des tickets ACTIVE (selection deterministe dessus).
    ticketModelMock.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([
              {
                _id: winnerTicketId,
                userId: winnerUserId,
                serial: 'TGL-TEST-ABCD1234',
              },
            ]),
          }),
        }),
      }),
    });
    ticketModelMock.distinct.mockResolvedValue([winnerUserId]);
    ticketModelMock.updateOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ acknowledged: true }),
    });

    // Claim atomique -> renvoie le document "reclame".
    const claimedDoc: any = {
      _id: raffleId,
      status: RaffleStatus.DRAWN,
      drawnAt: new Date(),
      winner: { ticketId: winnerTicketId, userId: winnerUserId },
    };
    raffleModelMock.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(claimedDoc),
    });

    jest
      .spyOn(service as any, 'notifyDrawStarted')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'notifyDrawResults')
      .mockResolvedValue(undefined);

    const result: any = await service.drawWinner(String(raffleId));

    // Selection deterministe sur l'ensemble ACTIVE (plus de $sample aleatoire).
    expect(ticketModelMock.find).toHaveBeenCalledWith({
      raffleId,
      status: 'ACTIVE',
    });

    // Claim ATOMIQUE: garde winnerTicketId:null, et la preuve (seed + serials
    // figes) est ecrite dans le meme $set.
    expect(raffleModelMock.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: raffleId, winnerTicketId: null },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: RaffleStatus.DRAWN,
          winnerTicketId,
          winnerUserId,
          drawServerSeed: 'a'.repeat(64),
          provablyFair: expect.objectContaining({
            algorithm: 'HMAC-SHA256',
            ticketCount: 1,
            winningIndex: 0,
            committedBeforeDraw: true,
            ticketsetHash: expect.any(String),
            digest: expect.any(String),
            serials: ['TGL-TEST-ABCD1234'],
          }),
        }),
      }),
      { new: true },
    );

    expect(ticketModelMock.updateOne).toHaveBeenCalledWith(
      { _id: winnerTicketId },
      { $set: { status: 'WINNER' } },
    );
    expect(result?.winner?.ticketId).toEqual(winnerTicketId);
    expect(result?.winner?.userId).toEqual(winnerUserId);
    expect(notificationsMock.create).toHaveBeenCalled();
  });
});
