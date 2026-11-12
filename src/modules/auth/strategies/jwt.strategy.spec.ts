import {
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const user = {
    _id: { toString: () => '665f1a2b3c4d5e6f7a8b9c0e' },
    email: 'user@example.com',
    role: 'USER',
    status: 'ACTIVE',
    tokenVersion: 0,
  };
  const payload = { sub: '665f1a2b3c4d5e6f7a8b9c0e', ver: 0 };

  const createStrategy = (findById: jest.Mock) => {
    const config = {
      get: jest.fn(() => 'lt_0123456789abcdef0123456789abcdef_secret'),
    } as unknown as ConfigService;
    return new JwtStrategy(config, { findById } as any);
  };

  it('answers 503 (retry) instead of 401 when the database is saturated', async () => {
    const poolTimeout = new Error(
      'Timed out while checking out a connection from connection pool',
    );
    poolTimeout.name = 'MongoWaitQueueTimeoutError';
    const strategy = createStrategy(jest.fn().mockRejectedValue(poolTimeout));

    // Un 401 ferait deconnecter l'utilisateur par l'app alors que son token est valide.
    await expect(strategy.validate(payload)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('still rejects a token whose user no longer exists', async () => {
    const strategy = createStrategy(
      jest.fn().mockRejectedValue(new NotFoundException('User not found')),
    );

    await expect(strategy.validate(payload)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('shares one database read between concurrent requests of the same user', async () => {
    let resolve!: (value: unknown) => void;
    const findById = jest.fn(
      () => new Promise((r) => {
        resolve = r;
      }),
    );
    const strategy = createStrategy(findById);

    const calls = [1, 2, 3, 4].map(() => strategy.validate(payload));
    resolve(user);
    const results = await Promise.all(calls);

    expect(findById).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.email === 'user@example.com')).toBe(true);
  });
});
