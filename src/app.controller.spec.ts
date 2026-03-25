import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersService } from './modules/users/users.service';
import { PaymentsService } from './modules/payments/payments.service';
import { RafflesService } from './modules/raffles/raffles.service';

describe('AppController', () => {
  let appController: AppController;
  const mongoConnectionMock = { readyState: 1 };

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: UsersService,
          useValue: {
            adminList: jest.fn(),
          },
        },
        {
          provide: PaymentsService,
          useValue: {
            adminTransactions: jest.fn(),
          },
        },
        {
          provide: RafflesService,
          useValue: {
            adminListAll: jest.fn(),
            adminListWinners: jest.fn(),
          },
        },
        {
          provide: getConnectionToken(),
          useValue: mongoConnectionMock,
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
    mongoConnectionMock.readyState = 1;
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('health', () => {
    it('should return ok health payload', () => {
      expect(appController.health()).toMatchObject({
        status: 'ok',
        service: 'tingilin-api',
      });
    });
  });

  describe('readiness', () => {
    it('should return ready when mongo is connected', () => {
      mongoConnectionMock.readyState = 1;
      expect(appController.readiness()).toMatchObject({
        status: 'ready',
        checks: {
          mongo: {
            status: 'up',
            state: 'connected',
            stateCode: 1,
          },
        },
      });
    });

    it('should throw when mongo is disconnected', () => {
      mongoConnectionMock.readyState = 0;
      expect(() => appController.readiness()).toThrow();
    });
  });
});
