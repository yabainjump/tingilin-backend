import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

export type DigikuntzStatus = string;

export interface DigikuntzTransactionResponse {
  id?: string;
  status?: DigikuntzStatus;
  transactionRef?: string;
  paymentLink?: string;
  paymentWithTaxes?: number | string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export type NormalizedDigikuntzStatus =
  | 'pending'
  | 'success'
  | 'failed'
  | 'unknown';

export function normalizeDigikuntzStatus(
  input?: string | null,
): NormalizedDigikuntzStatus {
  const status = String(input ?? '')
    .trim()
    .toLowerCase();
  if (!status) return 'unknown';

  if (status.includes('success') || status === 'completed') return 'success';
  if (status.includes('pending') || status.includes('initialized')) {
    return 'pending';
  }
  if (
    status.includes('error') ||
    status.includes('failed') ||
    status.includes('closed') ||
    status.includes('rejected') ||
    status.includes('cancelled') ||
    status.includes('canceled')
  ) {
    return 'failed';
  }

  return 'unknown';
}

@Injectable()
export class DigikuntzPaymentsService {
  private readonly baseUrl: string;
  private readonly userId: string;
  private readonly secretKey: string;
  private readonly callbackUrl: string;

  constructor(
    private readonly http: HttpService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {
    this.baseUrl = String(this.config.get<string>('DIGIKUNTZ_BASE_URL') ?? '')
      .trim()
      .replace(/\/+$/, '');
    this.userId = String(
      this.config.get<string>('DIGIKUNTZ_USER_ID') ?? '',
    ).trim();
    this.secretKey = String(
      this.config.get<string>('DIGIKUNTZ_SECRET_KEY') ?? '',
    ).trim();
    this.callbackUrl = this.resolveCallbackUrl();
  }

  private resolveCallbackUrl(): string {
    const configured = String(
      this.config.get<string>('DIGIKUNTZ_CALLBACK_URL') ?? '',
    ).trim();
    if (configured) return configured;

    const publicAppUrl = String(
      this.config.get<string>('PUBLIC_APP_URL') ??
        this.config.get<string>('APP_WEB_URL') ??
        '',
    ).trim();
    if (!publicAppUrl) return '';

    try {
      return new URL('/tabs/participations', publicAppUrl).toString();
    } catch {
      return '';
    }
  }

  assertConfigured(): void {
    this.requiredEnv('DIGIKUNTZ_BASE_URL');
    this.requiredEnv('DIGIKUNTZ_USER_ID');
    this.requiredEnv('DIGIKUNTZ_SECRET_KEY');
    const callbackUrl = this.requiredEnv('DIGIKUNTZ_CALLBACK_URL');

    let parsed: URL;
    try {
      parsed = new URL(callbackUrl);
    } catch {
      throw new ServiceUnavailableException(
        'Invalid payment config: DIGIKUNTZ_CALLBACK_URL must be an absolute URL',
      );
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new ServiceUnavailableException(
        'Invalid payment config: DIGIKUNTZ_CALLBACK_URL must use HTTP(S)',
      );
    }
  }

  private requiredEnv(name: string): string {
    const value = String(
      name === 'DIGIKUNTZ_BASE_URL'
        ? this.baseUrl
        : name === 'DIGIKUNTZ_USER_ID'
          ? this.userId
          : name === 'DIGIKUNTZ_SECRET_KEY'
            ? this.secretKey
            : this.callbackUrl,
    ).trim();
    if (!value) {
      throw new ServiceUnavailableException(
        `Missing required payment config: ${name}`,
      );
    }
    return value;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  }

  private asString(value: unknown): string {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value).trim();
    }
    return '';
  }

  private providerErrorMessage(data: unknown): string {
    const payload = this.asRecord(data);
    const direct = this.asString(
      payload.message ??
        payload.error ??
        payload.detail ??
        payload.reason ??
        payload.msg,
    );
    if (direct) return direct;

    const errors: unknown[] = Array.isArray(payload.errors)
      ? (payload.errors as unknown[])
      : [];
    if (errors.length > 0) {
      const first: unknown = errors[0];
      const firstError = this.asRecord(first);
      const fromArray = this.asString(
        firstError.message ?? firstError.error ?? firstError.detail ?? first,
      );
      if (fromArray) return fromArray;
    }

    return '';
  }

  private throwUpstreamError(action: string, e: unknown): never {
    if (e instanceof HttpException) {
      throw e;
    }

    const error = this.asRecord(e);
    const response = this.asRecord(error.response);
    const status = Number(response.status ?? 0);
    const details = this.providerErrorMessage(response.data);
    const suffix = details ? `: ${details}` : '';

    if (status >= 400 && status < 500) {
      throw new BadRequestException(
        `Digikuntz ${action} rejected request${status ? ` (${status})` : ''}${suffix}`,
      );
    }

    throw new BadGatewayException(
      `Digikuntz ${action} failed${status ? ` (${status})` : ''}${suffix}`,
    );
  }

  private headers() {
    this.assertConfigured();
    return {
      'x-user-id': this.userId,
      'x-secret-key': this.secretKey,
    };
  }

  private normalizeTransactionResponse(
    payload: unknown,
  ): DigikuntzTransactionResponse {
    const root = this.asRecord(payload);
    const details = this.asRecord(root.data);

    return {
      ...root,
      ...details,
      id: this.asString(root.id ?? details.id) || undefined,
      status: this.asString(root.status ?? details.status) || undefined,
      data: details,
    };
  }

  async createPayin(input: {
    amount: number;
    reason: string;
    userEmail: string;
    userPhone: string;
    userCountry: string;
    senderName: string;
  }) {
    try {
      const url = `${this.baseUrl}/transaction`;
      this.assertConfigured();
      const callbackUrl = this.callbackUrl;
      const body = {
        estimation: input.amount,
        raisonForTransfer: input.reason,
        userEmail: input.userEmail,
        userPhone: input.userPhone,
        userCountry: input.userCountry,
        senderName: input.senderName,
        callbackUrl,
      };

      const res = await firstValueFrom(
        this.http.post(url, body, { headers: this.headers() }),
      );
      return this.normalizeTransactionResponse(res.data);
    } catch (e: unknown) {
      this.throwUpstreamError('createPayin', e);
    }
  }

  async getTransaction(transactionId: string) {
    try {
      const url = `${this.baseUrl}/transaction`;
      const res = await firstValueFrom(
        this.http.get(url, {
          headers: this.headers(),
          params: { transactionId },
        }),
      );
      return this.normalizeTransactionResponse(res.data);
    } catch (e: unknown) {
      this.throwUpstreamError('getTransaction', e);
    }
  }
}
