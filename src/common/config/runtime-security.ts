import { ConfigService } from '@nestjs/config';

const UNSAFE_SECRET_PATTERN =
  /^(change[_-]?me|replace(?:[_-]?me|[_-]?with)?|placeholder|example|dummy|default|test(?:[_-](?:value|secret))?)(?:$|[_-])/i;

export function isProductionEnv(raw?: string | null): boolean {
  const normalized = String(raw ?? '')
    .trim()
    .toLowerCase();
  return normalized === 'prod' || normalized === 'production';
}

export function parseBooleanFlag(
  raw: string | boolean | undefined | null,
  fallback = false,
): boolean {
  if (typeof raw === 'boolean') return raw;

  const normalized = String(raw ?? '')
    .trim()
    .toLowerCase();

  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

export function getRequiredSecret(
  config: ConfigService,
  key: string,
  opts?: {
    minLength?: number;
  },
): string {
  const value = String(config.get<string>(key, '')).trim().replace(/\s+/g, '');
  const minLength = Math.max(16, Number(opts?.minLength ?? 32));

  if (!value) {
    throw new Error(`Missing required configuration: ${key}`);
  }

  if (UNSAFE_SECRET_PATTERN.test(value) || /change[_-]?me/i.test(value)) {
    throw new Error(`Unsafe secret configured for ${key}`);
  }

  if (value.length < minLength) {
    throw new Error(
      `Configuration ${key} must be at least ${minLength} characters long`,
    );
  }

  return value;
}

export function getWebhookSignatureMode(
  config: ConfigService,
): 'provider-verify' | 'hmac' | 'legacy-static' {
  const raw = String(
    config.get<string>('DIGIKUNTZ_WEBHOOK_SIGNATURE_MODE', 'provider-verify'),
  )
    .trim()
    .toLowerCase();

  if (raw === 'legacy-static') return 'legacy-static';
  if (raw === 'hmac') return 'hmac';
  return 'provider-verify';
}

export function assertRuntimeSecurityConfig(config: ConfigService): void {
  getRequiredSecret(config, 'JWT_ACCESS_SECRET', { minLength: 32 });
  getRequiredSecret(config, 'JWT_REFRESH_SECRET', { minLength: 32 });

  const isProd = isProductionEnv(config.get<string>('NODE_ENV', 'development'));
  if (!isProd) {
    return;
  }

  if (parseBooleanFlag(config.get<string>('SETUP_ENABLED', 'false'))) {
    throw new Error('SETUP_ENABLED must remain disabled in production');
  }

  if (
    parseBooleanFlag(config.get<string>('AUTH_BOOTSTRAP_FIRST_ADMIN', 'false'))
  ) {
    throw new Error(
      'AUTH_BOOTSTRAP_FIRST_ADMIN must remain disabled in production',
    );
  }

  if (parseBooleanFlag(config.get<string>('ENABLE_MOCK_PAYMENTS', 'false'))) {
    throw new Error('ENABLE_MOCK_PAYMENTS must remain disabled in production');
  }

  const signatureMode = getWebhookSignatureMode(config);
  if (signatureMode !== 'provider-verify') {
    getRequiredSecret(config, 'DIGIKUNTZ_WEBHOOK_SECRET', { minLength: 24 });
  }
  const allowInsecureWebhookMode = parseBooleanFlag(
    config.get<string>('ALLOW_INSECURE_WEBHOOK_SIGNATURE', 'false'),
  );

  if (signatureMode === 'legacy-static' && !allowInsecureWebhookMode) {
    throw new Error(
      'DIGIKUNTZ_WEBHOOK_SIGNATURE_MODE=legacy-static is blocked in production',
    );
  }
}
