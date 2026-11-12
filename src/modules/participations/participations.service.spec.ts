import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ParticipationsService } from './participations.service';
import { Participation } from './schemas/participation.schema';
import { Ticket } from '../tickets/schemas/ticket.schema';

describe('ParticipationsService', () => {
  let service: ParticipationsService;
  let participationModel: Record<string, jest.Mock>;

  beforeEach(async () => {
    participationModel = {
      updateOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      findOne: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ParticipationsService,
        {
          provide: getModelToken(Participation.name),
          useValue: participationModel,
        },
        {
          provide: getModelToken(Ticket.name),
          useValue: {
            aggregate: jest.fn().mockReturnValue({ exec: jest.fn() }),
          },
        },
      ],
    }).compile();

    service = module.get<ParticipationsService>(ParticipationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  const mockExisting = (totalTicketsBought: number | null) => {
    participationModel.findOne.mockReturnValue({
      session: jest.fn().mockReturnValue({
        exec: jest
          .fn()
          .mockResolvedValue(
            totalTicketsBought === null ? null : { totalTicketsBought },
          ),
      }),
    });
    participationModel.updateOne.mockReturnValue({
      exec: jest
        .fn()
        .mockResolvedValue({ upsertedCount: totalTicketsBought === null ? 1 : 0 }),
    });
  };

  const params = {
    raffleId: '665f1a2b3c4d5e6f7a8b9c0d',
    userId: '665f1a2b3c4d5e6f7a8b9c0e',
    quantity: 2,
  };

  it('counts a first purchase even when createIntent already created the participation', async () => {
    // createIntent -> getOrCreate cree le document avec 0 ticket avant paiement.
    mockExisting(0);
    await expect(service.upsertAfterPurchase(params)).resolves.toEqual({
      wasCreated: false,
      isFirstPurchase: true,
    });
  });

  it('does not count a repeat purchase as a new participant', async () => {
    mockExisting(3);
    await expect(service.upsertAfterPurchase(params)).resolves.toMatchObject({
      isFirstPurchase: false,
    });
  });

  it('counts a purchase with no prior participation document', async () => {
    mockExisting(null);
    await expect(service.upsertAfterPurchase(params)).resolves.toEqual({
      wasCreated: true,
      isFirstPurchase: true,
    });
  });
});
