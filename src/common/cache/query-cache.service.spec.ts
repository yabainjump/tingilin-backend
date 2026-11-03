import { ConfigService } from '@nestjs/config';
import { QueryCacheService } from './query-cache.service';

describe('QueryCacheService', () => {
  const config = {
    get: jest.fn().mockReturnValue(undefined),
  } as unknown as ConfigService;

  it('coalesces concurrent cache misses into one loader call', async () => {
    const cache = new QueryCacheService(null, config);
    const load = jest.fn(async () => ({ value: 42 }));

    const [first, second] = await Promise.all([
      cache.remember('same-key', load),
      cache.remember('same-key', load),
    ]);

    expect(load).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ value: 42 });
    expect(second).toEqual({ value: 42 });
  });

  it('uses Redis on a local miss and avoids the loader', async () => {
    const redis = {
      get: jest.fn().mockResolvedValue('{"cached":true}'),
      set: jest.fn(),
    } as any;
    const cache = new QueryCacheService(redis, config);
    const load = jest.fn(async () => ({ cached: false }));

    await expect(cache.remember('redis-key', load)).resolves.toEqual({
      cached: true,
    });
    expect(load).not.toHaveBeenCalled();
  });

  it('falls back to the loader when Redis fails', async () => {
    const redis = {
      get: jest.fn().mockRejectedValue(new Error('unavailable')),
      set: jest.fn().mockRejectedValue(new Error('unavailable')),
    } as any;
    const cache = new QueryCacheService(redis, config);

    await expect(
      cache.remember('fallback-key', async () => ({ ok: true })),
    ).resolves.toEqual({ ok: true });
  });

  it('invalidates local and Redis entries by prefix', async () => {
    const redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      scan: jest
        .fn()
        .mockResolvedValueOnce([
          '0',
          ['tingilin:query-cache:raffles:details:one'],
        ]),
      del: jest.fn().mockResolvedValue(1),
    } as any;
    const cache = new QueryCacheService(redis, config);
    const load = jest.fn(async () => ({ version: 1 }));

    await cache.remember('raffles:details:one', load);
    await cache.invalidatePrefix('raffles:');
    await cache.remember('raffles:details:one', load);

    expect(load).toHaveBeenCalledTimes(2);
    expect(redis.del).toHaveBeenCalledWith(
      'tingilin:query-cache:raffles:details:one',
    );
  });
});
