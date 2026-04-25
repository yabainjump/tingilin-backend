import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { AuditService } from '../audit/audit.service';

describe('AuthService', () => {
  let service: AuthService;
  let configValues: Record<string, string>;
  let usersService: {
    findById: jest.Mock;
  } & Record<string, jest.Mock>;

  beforeEach(async () => {
    configValues = {
      JWT_ACCESS_SECRET: '12345678901234567890123456789012',
      JWT_REFRESH_SECRET: 'abcdefghijklmnopqrstuvwxyz123456',
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
      NODE_ENV: 'test',
      PASSWORD_RESET_DEBUG_RESPONSE: 'false',
    };

    usersService = {
      findByEmail: jest.fn(),
      findByPhone: jest.fn(),
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
              return configValues[key] ?? fallback ?? '';
            }),
          },
        },
        { provide: AuditService, useValue: { safeLog: jest.fn() } },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
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

  it('returns a generic forgot-password response when user is missing', async () => {
    usersService.findByPhone.mockResolvedValue(null);
    usersService.findByEmail.mockResolvedValue(null);

    await expect(
      service.forgotPassword({ identifier: '699123456', phone: '699123456' }),
    ).resolves.toEqual({
      ok: true,
      message:
        'Si un compte correspond, un code sera envoyé à l’adresse email liée à ce compte.',
    });
  });

  it('returns debug delivery details when reset debug is enabled', async () => {
    configValues.PASSWORD_RESET_DEBUG_RESPONSE = 'true';
    const save = jest.fn().mockResolvedValue(undefined);
    usersService.findByPhone.mockResolvedValue({
      email: 'user@example.com',
      firstName: 'Jean',
      passwordResetRequestedAt: null,
      save,
    });

    const result = await service.forgotPassword({
      identifier: '699123456',
      phone: '699123456',
    });

    expect(result).toMatchObject({
      ok: true,
      delivery: 'LOG',
      deliveryReason: 'SMTP_CONFIG_MISSING',
    });
    expect(String(result.devResetCode ?? '')).toHaveLength(6);
    expect(save).toHaveBeenCalled();
  });

  it('reports SMTP send failures when transport rejects the email', async () => {
    configValues.PASSWORD_RESET_DEBUG_RESPONSE = 'true';
    jest.spyOn(service as any, 'buildSmtpTransporter').mockReturnValue({
      transporter: {
        sendMail: jest.fn().mockRejectedValue(new Error('Invalid login')),
      },
    });

    const save = jest.fn().mockResolvedValue(undefined);
    usersService.findByEmail.mockResolvedValue({
      email: 'user@example.com',
      firstName: 'Jean',
      passwordResetRequestedAt: null,
      save,
    });

    const result = await service.forgotPassword({
      identifier: 'user@example.com',
      email: 'user@example.com',
    });

    expect(result).toMatchObject({
      ok: true,
      delivery: 'LOG',
      deliveryReason: 'SMTP_SEND_FAILED',
    });
  });
});
