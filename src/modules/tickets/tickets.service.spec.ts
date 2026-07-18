import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { TicketsService } from './tickets.service';
import { Ticket } from './schemas/ticket.schema';

describe('TicketsService', () => {
  let service: TicketsService;
  let model: any;

  beforeEach(async () => {
    model = {
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        session: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      }),
      bulkWrite: jest.fn().mockResolvedValue({ upsertedCount: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TicketsService,
        { provide: getModelToken(Ticket.name), useValue: model },
      ],
    }).compile();

    service = module.get<TicketsService>(TicketsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  const params = (quantity = 3) => ({
    raffleId: new Types.ObjectId().toString(),
    userId: new Types.ObjectId().toString(),
    transactionId: new Types.ObjectId().toString(),
    quantity,
  });

  it('createMany upserts one deterministic slot per requested ticket', async () => {
    await service.createMany(params(3));

    expect(model.bulkWrite).toHaveBeenCalledTimes(1);
    const operations = model.bulkWrite.mock.calls[0][0];
    expect(operations).toHaveLength(3);
    expect(operations.map((operation: any) => operation.updateOne.filter.sequence))
      .toEqual([0, 1, 2]);
    expect(operations.every((operation: any) => operation.updateOne.upsert))
      .toBe(true);
  });

  it('createMany uses the same unique slots on replay', async () => {
    const input = params(2);
    await service.createMany(input);
    await service.createMany(input);

    const first = model.bulkWrite.mock.calls[0][0];
    const second = model.bulkWrite.mock.calls[1][0];
    expect(first.map((operation: any) => operation.updateOne.filter.sequence))
      .toEqual(second.map((operation: any) => operation.updateOne.filter.sequence));
  });
});
