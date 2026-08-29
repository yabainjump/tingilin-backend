import { ConfigService } from '@nestjs/config';
import {
  assertRuntimeSecurityConfig,
  getRequiredSecret,
} from './runtime-security';

function config(values: Record<string, string>): ConfigService {
  return {
    get: (key: string, fallback?: string) => values[key] ?? fallback,
  } as ConfigService;
}

describe('runtime security configuration', () => {
  const productionBase = {
    NODE_ENV: 'production',
    JWT_ACCESS_SECRET: 'access-4f53d919774c4e999b27f2a39fd76c70',
    JWT_REFRESH_SECRET: 'refresh-6fa2ae56904f47dbbe972c73cd95b519',
  };

  it.each([
    'replace-with-a-long-random-access-secret',
    'placeholder-123456789012345678901234567890',
    'dummy_12345678901234567890123456789012',
  ])('rejects known placeholder secret %s', (value) => {
    expect(() =>
      getRequiredSecret(
        config({ JWT_ACCESS_SECRET: value }),
        'JWT_ACCESS_SECRET',
      ),
    ).toThrow('Unsafe secret');
  });

  it('accepts a non-placeholder high-entropy secret', () => {
    expect(getRequiredSecret(config(productionBase), 'JWT_ACCESS_SECRET')).toBe(
      productionBase.JWT_ACCESS_SECRET,
    );
  });

  it.each(['AUTH_BOOTSTRAP_FIRST_ADMIN', 'ENABLE_MOCK_PAYMENTS'])(
    'blocks %s in production',
    (flag) => {
      expect(() =>
        assertRuntimeSecurityConfig(
          config({ ...productionBase, [flag]: 'true' }),
        ),
      ).toThrow(`${flag} must remain disabled in production`);
    },
  );
});
