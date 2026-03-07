import { Test, TestingModule } from '@nestjs/testing';
import { RafflesController } from './raffles.controller';
import { RafflesService } from './raffles.service';
import { RafflesPublicService } from './raffles.public.service';

describe('RafflesController', () => {
  let controller: RafflesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RafflesController],
      providers: [
        { provide: RafflesService, useValue: {} },
        { provide: RafflesPublicService, useValue: {} },
      ],
    }).compile();

    controller = module.get<RafflesController>(RafflesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
