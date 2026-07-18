import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  Logger,
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
  private readonly logger = new Logger(DigikuntzPaymentsService.name);
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
    const baseUrl = this.requiredEnv('DIGIKUNTZ_BASE_URL');
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

    let parsedBaseUrl: URL;
    try {
      parsedBaseUrl = new URL(baseUrl);
    } catch {
      throw new ServiceUnavailableException(
        'Invalid payment config: DIGIKUNTZ_BASE_URL must be an absolute URL',
      );
    }
    if (parsedBaseUrl.protocol !== 'https:') {
      throw new ServiceUnavailableException(
        'Invalid payment config: DIGIKUNTZ_BASE_URL must use HTTPS',
      );
    }
    const normalizedPath = parsedBaseUrl.pathname.replace(/\/+$/, '') || '/';
    if (
      parsedBaseUrl.origin.toLowerCase() !== 'https://app.digikuntz.com' ||
      normalizedPath !== '/dev' ||
      parsedBaseUrl.search ||
      parsedBaseUrl.hash
    ) {
      throw new ServiceUnavailableException(
        'Invalid payment config: DIGIKUNTZ_BASE_URL must be exactly https://app.digikuntz.com/dev',
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

  private transactionRecords(payload: unknown): Record<string, unknown>[] {
    const root = this.asRecord(payload);
    if (Object.keys(root).length === 0) return [];

    const records: Record<string, unknown>[] = [];
    const queue: Array<{ value: Record<string, unknown>; depth: number }> = [
      { value: root, depth: 0 },
    ];
    const visited = new Set<Record<string, unknown>>();
    const envelopeKeys = [
      'data',
      'result',
      'transaction',
      'payment',
      'payin',
      'response',
    ];

    while (queue.length > 0 && records.length < 12) {
      const current = queue.shift()!;
      if (visited.has(current.value)) continue;
      visited.add(current.value);
      records.push(current.value);
      if (current.depth >= 5) continue;

      for (const key of envelopeKeys) {
        const nested = this.asRecord(current.value[key]);
        if (Object.keys(nested).length > 0) {
          queue.push({ value: nested, depth: current.depth + 1 });
        }
      }
    }

    return records;
  }

  private firstRecordValue(
    records: Record<string, unknown>[],
    keys: string[],
  ): string {
    for (const record of [...records].reverse()) {
      for (const key of keys) {
        const value = this.asString(record[key]);
        if (value) return value;
      }
    }
    return '';
  }

  private httpUrl(value: string): string {
    if (!value) return '';
    try {
      const parsed = new URL(value);
      return ['http:', 'https:'].includes(parsed.protocol)
        ? parsed.toString()
        : '';
    } catch {
      return '';
    }
  }

  private payloadShape(records: Record<string, unknown>[]): string {
    return records
      .map(
        (record, index) => `${index}:${Object.keys(record).sort().join(',')}`,
      )
      .join(' | ')
      .slice(0, 800);
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
      Accept: 'application/json',
      'x-user-id': this.userId,
      'x-secret-key': this.secretKey,
    };
  }

  private decodeJsonPayload(payload: unknown): unknown {
    if (typeof payload !== 'string') return payload;

    const trimmed = payload.trim();
    if (!trimmed) return payload;

    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return payload;
    }
  }

  private normalizeTransactionResponse(
    payload: unknown,
  ): DigikuntzTransactionResponse {
    const records = this.transactionRecords(payload);
    const root = records[0] ?? {};
    const flattened = Object.assign({}, ...records);
    const id = this.firstRecordValue(records, [
      'id',
      '_id',
      'transactionId',
      'transaction_id',
      'providerTransactionId',
    ]);
    const status = this.firstRecordValue(records, ['status', 'state']);
    const transactionRef = this.firstRecordValue(records, [
      'transactionRef',
      'transaction_ref',
      'reference',
      'ref',
      'providerRef',
    ]);
    const paymentLink = this.httpUrl(
      this.firstRecordValue(records, [
        'paymentLink',
        'payment_link',
        'paymentUrl',
        'payment_url',
        'checkoutUrl',
        'checkout_url',
        'link',
        'url',
      ]),
    );
    const paymentWithTaxes = this.firstRecordValue(records, [
      'paymentWithTaxes',
      'payment_with_taxes',
      'amountWithTaxes',
      'amount_with_taxes',
    ]);

    return {
      ...root,
      ...flattened,
      id: id || undefined,
      status: status || undefined,
      transactionRef: transactionRef || undefined,
      paymentLink: paymentLink || undefined,
      paymentWithTaxes: paymentWithTaxes || undefined,
      data: flattened,
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
      const contentType = String(res.headers?.['content-type'] ?? '')
        .trim()
        .toLowerCase();
      const payload = this.decodeJsonPayload(res.data);
      if (typeof payload === 'string') {
        this.logger.warn(
          `Digikuntz createPayin returned non-JSON content; status=${Number(res.status ?? 0) || 'unknown'}; contentType=${contentType || 'unknown'}; baseUrl=${this.baseUrl}`,
        );
        throw new BadGatewayException(
          'Digikuntz returned an invalid response instead of payment JSON; verify the production API credentials and contact Digikuntz if the issue persists',
        );
      }
      const normalized = this.normalizeTransactionResponse(payload);
      if (
        !normalized.id &&
        !normalized.transactionRef &&
        !normalized.paymentLink
      ) {
        const records = this.transactionRecords(payload);
        this.logger.warn(
          `Digikuntz createPayin response has no transaction fields; shape=${this.payloadShape(records) || 'empty'}`,
        );
      }
      return normalized;
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
