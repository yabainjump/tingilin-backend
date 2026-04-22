import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

export type DigikuntzStatus =
  | 'pending'
  | 'success'
  | 'closed'
  | 'error'
  | string;

@Injectable()
export class DigikuntzPaymentsService {
  private readonly baseUrl: string;
  private readonly userId: string;
  private readonly secretKey: string;

  constructor(
    private readonly http: HttpService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {
    this.baseUrl = String(this.config.get<string>('DIGIKUNTZ_BASE_URL') ?? '')
      .trim()
      .replace(/\/+$/, '');
    this.userId = String(this.config.get<string>('DIGIKUNTZ_USER_ID') ?? '').trim();
    this.secretKey = String(
      this.config.get<string>('DIGIKUNTZ_SECRET_KEY') ?? '',
    ).trim();
  }

  private requiredEnv(name: string): string {
    const value = String(
      name === 'DIGIKUNTZ_BASE_URL'
        ? this.baseUrl
        : name === 'DIGIKUNTZ_USER_ID'
          ? this.userId
          : this.secretKey,
    ).trim();
    if (!value) {
      throw new ServiceUnavailableException(
        `Missing required payment config: ${name}`,
      );
    }
    return value;
  }

  private providerErrorMessage(data: any): string {
    const direct = String(
      data?.message ??
        data?.error ??
        data?.detail ??
        data?.reason ??
        data?.msg ??
        '',
    ).trim();
    if (direct) return direct;

    if (Array.isArray(data?.errors) && data.errors.length > 0) {
      const first = data.errors[0];
      const fromArray = String(
        first?.message ?? first?.error ?? first?.detail ?? first ?? '',
      ).trim();
      if (fromArray) return fromArray;
    }

    return '';
  }

  private throwUpstreamError(action: string, e: any): never {
    const status = Number(e?.response?.status ?? 0);
    const details = this.providerErrorMessage(e?.response?.data);
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
    this.requiredEnv('DIGIKUNTZ_BASE_URL');
    this.requiredEnv('DIGIKUNTZ_USER_ID');
    this.requiredEnv('DIGIKUNTZ_SECRET_KEY');
    return {
      'x-user-id': this.userId,
      'x-secret-key': this.secretKey,
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
      const body = {
        estimation: input.amount,
        raisonForTransfer: input.reason,
        userEmail: input.userEmail,
        userPhone: input.userPhone,
        userCountry: input.userCountry,
        senderName: input.senderName,
      };

      const res = await firstValueFrom(
        this.http.post(url, body, { headers: this.headers() }),
      );
      return res.data;
    } catch (e: any) {
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
      return res.data;
    } catch (e: any) {
      this.throwUpstreamError('getTransaction', e);
    }
  }
}
