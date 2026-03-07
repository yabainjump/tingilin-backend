import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { UsersService } from './users.service';
import { User } from './schemas/user.schema';
import { Ticket } from '../tickets/schemas/ticket.schema';
import { Raffle } from '../raffles/schemas/raffle.schema';
import { Product } from '../products/schemas/product.schema';
import { NotificationsService } from '../notifications/notifications.service';

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
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
        { provide: getModelToken(User.name), useValue: modelMock },
        { provide: getModelToken(Ticket.name), useValue: modelMock },
        { provide: getModelToken(Raffle.name), useValue: modelMock },
        { provide: getModelToken(Product.name), useValue: modelMock },
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
});
