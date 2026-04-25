import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { UsersService } from './users.service';
import { User } from './schemas/user.schema';
import { Ticket } from '../tickets/schemas/ticket.schema';
import { Raffle } from '../raffles/schemas/raffle.schema';
import { Product } from '../products/schemas/product.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { Transaction } from '../payments/schemas/transaction.schema';
import { Participation } from '../participations/schemas/participation.schema';

describe('UsersService', () => {
  let service: UsersService;
  let userModelMock: any;

  beforeEach(async () => {
    userModelMock = {
      findOne: jest.fn(),
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      create: jest.fn(),
      exists: jest.fn(),
      countDocuments: jest.fn(),
      distinct: jest.fn(),
      find: jest.fn(),
      aggregate: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };

    const modelMock = {
      findOne: jest.fn(),
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      create: jest.fn(),
      exists: jest.fn(),
      countDocuments: jest.fn(),
      distinct: jest.fn(),
      find: jest.fn(),
      aggregate: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name), useValue: userModelMock },
        { provide: getModelToken(Ticket.name), useValue: modelMock },
        { provide: getModelToken(Raffle.name), useValue: modelMock },
        { provide: getModelToken(Product.name), useValue: modelMock },
        { provide: getModelToken(Transaction.name), useValue: modelMock },
        { provide: getModelToken(Participation.name), useValue: modelMock },
        {
          provide: NotificationsService,
          useValue: { create: jest.fn(), createOnce: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should block demoting the last active admin', async () => {
    const adminUser = {
      _id: 'admin-id',
      role: 'ADMIN',
      status: 'ACTIVE',
      save: jest.fn(),
    };

    userModelMock.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(adminUser),
    });
    userModelMock.countDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(1),
    });

    await expect(
      service.updateRole('507f1f77bcf86cd799439011', 'USER', 'actor-id'),
    ).rejects.toThrow('Cannot demote the last active admin');
  });

  it('should block self status changes', async () => {
    const adminUser = {
      _id: '507f1f77bcf86cd799439011',
      role: 'ADMIN',
      status: 'ACTIVE',
      save: jest.fn(),
    };

    userModelMock.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(adminUser),
    });

    await expect(
      service.updateStatus(
        '507f1f77bcf86cd799439011',
        'SUSPENDED',
        '507f1f77bcf86cd799439011',
      ),
    ).rejects.toThrow('You cannot change your own status');
  });
});
