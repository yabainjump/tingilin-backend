import { Test, TestingModule } from '@nestjs/testing';
import { RafflesService } from './raffles.service';

describe('RafflesService', () => {
  let service: RafflesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RafflesService],
    }).compile();

    service = module.get<RafflesService>(RafflesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
