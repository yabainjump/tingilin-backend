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
        exec: jest.fn().mockResolvedValue([]),
      }),
      countDocuments: jest.fn(),
      insertMany: jest.fn().mockResolvedValue([]),
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

  it('createMany only inserts the MISSING tickets (idempotent)', async () => {
    // 1 deja en base, quantity 3 -> n'insere que 2 (jamais de doublon).
    model.countDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(1),
    });

    await service.createMany(params(3));

    expect(model.insertMany).toHaveBeenCalledTimes(1);
    const docs = model.insertMany.mock.calls[0][0];
    expect(docs).toHaveLength(2);
  });

  it('createMany inserts nothing when the quantity already exists (replay)', async () => {
    model.countDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(3),
    });

    await service.createMany(params(3));

    expect(model.insertMany).not.toHaveBeenCalled();
  });

  it('createMany re-loops on a duplicate-serial collision and completes the rest', async () => {
    // 1er tour: 0 en base -> tente d'inserer 2, collision (11000).
    // 2e tour: 1 s'est insere malgre tout -> il reste 1 a creer.
    let count = 0;
    model.countDocuments.mockReturnValue({
      exec: jest.fn().mockImplementation(async () => {
        const v = count;
        count = 1; // apres la 1ere tentative, 1 ticket existe
        return v;
      }),
    });
    model.insertMany
      .mockRejectedValueOnce(
        Object.assign(new Error('dup'), { code: 11000 }),
      )
      .mockResolvedValueOnce([]);

    await service.createMany(params(2));

    expect(model.insertMany).toHaveBeenCalledTimes(2);
    expect(model.insertMany.mock.calls[0][0]).toHaveLength(2); // tour 1: 2
    expect(model.insertMany.mock.calls[1][0]).toHaveLength(1); // tour 2: le reste
  });
});
