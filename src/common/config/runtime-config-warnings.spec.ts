import { ConfigService } from '@nestjs/config';
import {
  assertRuntimeSecurityConfig,
  runtimeConfigWarnings,
} from './runtime-security';

const cfg = (values: Record<string, string>) =>
  ({ get: (k: string, d?: string) => values[k] ?? d }) as unknown as ConfigService;

const base = {
  JWT_ACCESS_SECRET: 'Ac7vR2xK9pL4wN8zT1cY6hB3jF5sD0gQ',
  JWT_REFRESH_SECRET: 'Rf8kL2mQ9vX4pZ7tW1nB6cY3hJ5sD0gA',
};

describe('runtime config warnings', () => {
  it('warns when email links cannot be built in production', () => {
    const w = runtimeConfigWarnings(cfg({ ...base, NODE_ENV: 'production' }));
    expect(w.join(' ')).toContain('PUBLIC_APP_URL');
    expect(w.join(' ')).toContain('WINNER_CLAIM_SECRET');
  });

  it('is quiet when production is fully configured', () => {
    expect(
      runtimeConfigWarnings(
        cfg({
          ...base,
          NODE_ENV: 'production',
          PUBLIC_APP_URL: 'https://tinguilin.yaba-in.com',
          WINNER_CLAIM_SECRET: 'Wc3nT8pQ1xL6vR9kZ2mB5hJ7sD4gF0aY',
        }),
      ),
    ).toEqual([]);
  });

  it('rejects an http app URL in production', () => {
    const w = runtimeConfigWarnings(
      cfg({ ...base, NODE_ENV: 'production', PUBLIC_APP_URL: 'http://tinguilin.yaba-in.com' }),
    );
    expect(w.join(' ')).toContain('PUBLIC_APP_URL');
  });

  it('refuses to start with a weak WINNER_CLAIM_SECRET', () => {
    expect(() =>
      assertRuntimeSecurityConfig(cfg({ ...base, WINNER_CLAIM_SECRET: 'short' })),
    ).toThrow();
  });
});
