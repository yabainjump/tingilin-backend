import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { AuditService } from '../audit/audit.service';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: {
    findById: jest.Mock;
  } & Record<string, jest.Mock>;

  beforeEach(async () => {
    usersService = {
      findByEmail: jest.fn(),
      findByReferralCode: jest.fn(),
      createUser: jest.fn(),
      savePasswordResetCode: jest.fn(),
      findByResetCode: jest.fn(),
      clearPasswordResetCode: jest.fn(),
      updatePassword: jest.fn(),
      findById: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: usersService,
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn((payload: any) =>
              payload?.type === 'refresh'
                ? `refresh.${payload?.jti ?? 'token'}`
                : 'access.token',
            ),
            verifyAsync: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: string) => {
              const values: Record<string, string> = {
                JWT_ACCESS_SECRET: '12345678901234567890123456789012',
                JWT_REFRESH_SECRET: 'abcdefghijklmnopqrstuvwxyz123456',
                JWT_ACCESS_EXPIRES_IN: '15m',
                JWT_REFRESH_EXPIRES_IN: '7d',
                NODE_ENV: 'test',
                PASSWORD_RESET_DEBUG_RESPONSE: 'false',
              };
              return values[key] ?? fallback ?? '';
            }),
          },
        },
        { provide: AuditService, useValue: { safeLog: jest.fn() } },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('rotates refresh token state on logout', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    usersService.findById.mockResolvedValue({
      _id: { toString: () => 'user-1' },
      tokenVersion: 2,
      save,
    });

    await expect(service.logout('user-1')).resolves.toEqual({ ok: true });
    expect(save).toHaveBeenCalled();
  });
});
