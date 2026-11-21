import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage } from '@nestjs/throttler';
import { UserAwareThrottlerGuard } from './user-aware-throttler.guard';

describe('UserAwareThrottlerGuard', () => {
  const secret = 'Qm7vR2xK9pL4wN8zT1cY6hB3jF5sD0gA';
  const userId = '665f1a2b3c4d5e6f7a8b9c0e';
  const guard = new UserAwareThrottlerGuard(
    { throttlers: [{ ttl: 60_000, limit: 120 }] },
    {} as ThrottlerStorage,
    new Reflector(),
    { get: (key: string) => (key === 'JWT_ACCESS_SECRET' ? secret : undefined) } as unknown as ConfigService,
  );
  const tracker = (req: Record<string, any>) =>
    (guard as any).getTracker(req) as Promise<string>;
  const sign = (payload: object, key = secret, expiresIn: number = 900) =>
    new JwtService({ secret: key }).sign(payload, { expiresIn });

  it('counts two players behind the same mobile-carrier IP separately', async () => {
    const other = '665f1a2b3c4d5e6f7a8b9c0f';
    const a = await tracker({ ip: '41.202.1.1', headers: { authorization: `Bearer ${sign({ sub: userId })}` } });
    const b = await tracker({ ip: '41.202.1.1', headers: { authorization: `Bearer ${sign({ sub: other })}` } });
    expect(a).toBe(`user:${userId}`);
    expect(b).toBe(`user:${other}`);
  });

  it('falls back to the IP for anonymous requests', async () => {
    expect(await tracker({ ip: '41.202.1.1', headers: {} })).toBe('ip:41.202.1.1');
  });

  it('ignores a forged, expired or foreign token (no way to dodge the limit)', async () => {
    const forged = sign({ sub: userId }, 'Zx9Lk2Pq7Wm4Rt8Vb1Nc6Hy3Jd5Gf0Sa');
    const expired = sign({ sub: userId }, secret, -10);
    for (const token of [forged, expired, 'not-a-jwt-but-long-enough-xxxx']) {
      expect(
        await tracker({ ip: '41.202.1.1', headers: { authorization: `Bearer ${token}` } }),
      ).toBe('ip:41.202.1.1');
    }
  });

  it('rejects a valid token whose subject is not a user id', async () => {
    const token = sign({ sub: { $ne: null } });
    expect(
      await tracker({ ip: '41.202.1.1', headers: { authorization: `Bearer ${token}` } }),
    ).toBe('ip:41.202.1.1');
  });
});
