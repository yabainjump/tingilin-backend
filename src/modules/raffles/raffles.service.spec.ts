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

describe('RafflesService', () => {
  let service: RafflesService;
  let raffleModelMock: any;
  let productModelMock: any;

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
      aggregate: jest.fn(),
      findOneAndUpdate: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      create: jest.fn(),
    };

    productModelMock = {
      find: jest.fn(),
      findById: jest.fn(),
      countDocuments: jest.fn(),
      aggregate: jest.fn(),
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RafflesService,
        { provide: getModelToken(Raffle.name), useValue: raffleModelMock },
        { provide: getModelToken(Product.name), useValue: productModelMock },
        { provide: getModelToken(Ticket.name), useValue: modelMock },
        { provide: getModelToken(User.name), useValue: modelMock },
        { provide: getModelToken(Transaction.name), useValue: modelMock },
        { provide: getModelToken(Participation.name), useValue: modelMock },
        { provide: ProductsService, useValue: {} },
        { provide: getConnectionToken(), useValue: {} },
        { provide: NotificationsService, useValue: {} },
      ],
    }).compile();

    service = module.get<RafflesService>(RafflesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('listPublic(sort=endAt) should only query active LIVE raffles', async () => {
    await service.listPublic({ sort: 'endAt', limit: 10 });

    expect(raffleModelMock.find).toHaveBeenCalledWith(
      expect.objectContaining({
        status: RaffleStatus.LIVE,
        endAt: expect.objectContaining({ $gt: expect.any(Date) }),
        $or: expect.any(Array),
      }),
    );
  });

  it('listPublic(sort=createdAt) should include LIVE/CLOSED/DRAWN', async () => {
    await service.listPublic({ sort: 'createdAt', limit: 10 });

    expect(raffleModelMock.find).toHaveBeenCalledWith(
      expect.objectContaining({
        status: expect.objectContaining({
          $in: [RaffleStatus.LIVE, RaffleStatus.CLOSED, RaffleStatus.DRAWN],
        }),
      }),
    );
  });

  it('listPublic(category=all) should skip product category filtering', async () => {
    await service.listPublic({ sort: 'endAt', limit: 10, category: 'all' });

    const match = raffleModelMock.find.mock.calls.at(-1)?.[0];
    expect(productModelMock.find).not.toHaveBeenCalled();
    expect(match?.productId).toBeUndefined();
  });
});
