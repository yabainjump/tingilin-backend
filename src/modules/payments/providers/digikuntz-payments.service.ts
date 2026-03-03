import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

export type DigikuntzStatus =
  | 'pending'
  | 'success'
  | 'closed'
  | 'error'
  | string;

@Injectable()
export class DigikuntzPaymentsService {
  private readonly baseUrl = process.env.DIGIKUNTZ_BASE_URL!;
  private readonly userId = process.env.DIGIKUNTZ_USER_ID!;
  private readonly secretKey = process.env.DIGIKUNTZ_SECRET_KEY!;

  constructor(private readonly http: HttpService) {}

  private headers() {
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
      throw new InternalServerErrorException(
        `Digikuntz createPayin failed: ${e?.message ?? 'unknown'}`,
      );
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
      throw new InternalServerErrorException(
        `Digikuntz getTransaction failed: ${e?.message ?? 'unknown'}`,
      );
    }
  }
}
