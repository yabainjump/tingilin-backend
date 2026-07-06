import { ServiceUnavailableException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosResponse } from 'axios';
import { of } from 'rxjs';
import {
  DigikuntzPaymentsService,
  normalizeDigikuntzStatus,
} from './digikuntz-payments.service';

describe('DigikuntzPaymentsService', () => {
  const configValues: Record<string, string> = {
    DIGIKUNTZ_BASE_URL: 'https://app.digikuntz.com/dev',
    DIGIKUNTZ_USER_ID: 'account-user-id',
    DIGIKUNTZ_SECRET_KEY: 'SK-secret',
    DIGIKUNTZ_CALLBACK_URL: 'https://tinguilin.yaba-in.com/tabs/participations',
  };

  const createService = (overrides: Record<string, string> = {}) => {
    const values = { ...configValues, ...overrides };
    const post = jest.fn();
    const get = jest.fn();
    const http = {
      post,
      get,
    } as unknown as HttpService;
    const config = {
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;

    return {
      service: new DigikuntzPaymentsService(http, config),
      post,
      get,
    };
  };

  it('sends the documented pay-in request and flattens response data', async () => {
    const { service, post } = createService();
    post.mockReturnValue(
      of({
        data: {
          id: 'provider-id',
          status: 'payin_pending',
          data: {
            transactionRef: 'IN123#250101120000',
            paymentWithTaxes: '105',
            paymentLink: 'https://checkout.flutterwave.com/pay/test',
          },
        },
      } as AxiosResponse),
    );

    const result = await service.createPayin({
      amount: 100,
      reason: 'Tingilin payment ABC123 x1',
      userEmail: 'user@example.com',
      userPhone: '691224472',
      userCountry: 'Cameroon',
      senderName: 'Test User',
    });

    expect(post).toHaveBeenCalledWith(
      'https://app.digikuntz.com/dev/transaction',
      {
        estimation: 100,
        raisonForTransfer: 'Tingilin payment ABC123 x1',
        userEmail: 'user@example.com',
        userPhone: '691224472',
        userCountry: 'Cameroon',
        senderName: 'Test User',
        callbackUrl: 'https://tinguilin.yaba-in.com/tabs/participations',
      },
      {
        headers: {
          'x-user-id': 'account-user-id',
          'x-secret-key': 'SK-secret',
        },
      },
    );
    expect(result).toMatchObject({
      id: 'provider-id',
      status: 'payin_pending',
      transactionRef: 'IN123#250101120000',
      paymentWithTaxes: '105',
      paymentLink: 'https://checkout.flutterwave.com/pay/test',
    });
  });

  it('uses the documented transaction lookup endpoint', async () => {
    const { service, get } = createService();
    get.mockReturnValue(
      of({
        data: { id: 'provider-id', status: 'payin_success', data: {} },
      } as AxiosResponse),
    );

    const result = await service.getTransaction('provider-id');

    expect(get).toHaveBeenCalledWith(
      'https://app.digikuntz.com/dev/transaction',
      {
        headers: {
          'x-user-id': 'account-user-id',
          'x-secret-key': 'SK-secret',
        },
        params: { transactionId: 'provider-id' },
      },
    );
    expect(result.status).toBe('payin_success');
  });

  it('fails clearly when callbackUrl is not configured', async () => {
    const { service } = createService({ DIGIKUNTZ_CALLBACK_URL: '' });

    await expect(
      service.createPayin({
        amount: 100,
        reason: 'Test',
        userEmail: 'user@example.com',
        userPhone: '691224472',
        userCountry: 'Cameroon',
        senderName: 'Test User',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it.each([
    ['payin_pending', 'pending'],
    ['transaction_payin_success', 'success'],
    ['payin_closed', 'failed'],
    ['payin_error', 'failed'],
    ['payout_rejected', 'failed'],
  ])('normalizes provider status %s to %s', (raw, expected) => {
    expect(normalizeDigikuntzStatus(raw)).toBe(expected);
  });
});
