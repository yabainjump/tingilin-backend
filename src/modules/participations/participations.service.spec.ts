import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ParticipationsService } from './participations.service';
import { Participation } from './schemas/participation.schema';

describe('ParticipationsService', () => {
  let service: ParticipationsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ParticipationsService,
        {
          provide: getModelToken(Participation.name),
          useValue: {
            updateOne: jest.fn(),
            findOneAndUpdate: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ParticipationsService>(ParticipationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
