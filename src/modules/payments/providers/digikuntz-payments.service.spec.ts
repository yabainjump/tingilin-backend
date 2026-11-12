import {
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosResponse } from 'axios';
import { of, throwError } from 'rxjs';
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
    DIGIKUNTZ_CHECKOUT_HOSTS:
      'checkout.flutterwave.com,app.digikuntz.com,checkout.example.com',
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

  it('validates provider access once within the cache window', async () => {
    const { service, get } = createService();
    get.mockReturnValue(
      of({
        data: { balance: 85000, currency: 'XAF' },
        headers: { 'content-type': 'application/json' },
      } as AxiosResponse),
    );

    await service.assertAccessible();
    await service.assertAccessible();

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith(
      'https://app.digikuntz.com/dev/balance',
      {
        headers: {
          Accept: 'application/json',
          'x-user-id': 'account-user-id',
          'x-secret-key': 'SK-secret',
        },
      },
    );
  });

  it('rejects disabled or invalid provider credentials returned as text', async () => {
    const { service, get } = createService();
    get.mockReturnValue(
      of({
        data: 'invalid credentials or API access desabled or Unauthorize',
        headers: { 'content-type': 'text/html' },
      } as AxiosResponse),
    );

    await expect(service.assertAccessible()).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

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
          Accept: 'application/json',
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

  it('sends the documented direct-charge request without requiring a checkout link', async () => {
    const { service, post } = createService();
    post.mockReturnValue(
      of({
        data: {
          id: 'direct-provider-id',
          status: 'payin_pending',
          data: {
            estimation: '5000',
            transactionRef: 'IN123#250101120000',
            invoiceTaxes: '250',
            paymentWithTaxes: '5250',
            receiverCurrency: 'XAF',
          },
        },
      } as AxiosResponse),
    );

    const result = await service.createDirectCharge({
      amount: 5000,
      reason: 'Tingilin payment ABC123 x1',
      userEmail: 'user@example.com',
      userPhone: '237691224472',
      userCountry: 'Cameroon',
      senderName: 'Test User',
      paymentMethodCode: 'MTN',
      currency: 'XAF',
      idempotencyKey: 'tingilin-direct-test',
    });

    expect(post).toHaveBeenCalledWith(
      'https://app.digikuntz.com/dev/direct-charge',
      {
        estimation: 5000,
        currency: 'XAF',
        userPhone: '237691224472',
        userEmail: 'user@example.com',
        userCountry: 'Cameroon',
        senderName: 'Test User',
        paymentMethodCode: 'MTN',
        callbackUrl: 'https://tinguilin.yaba-in.com/tabs/participations',
        raisonForTransfer: 'Tingilin payment ABC123 x1',
      },
      {
        headers: {
          Accept: 'application/json',
          'x-user-id': 'account-user-id',
          'x-secret-key': 'SK-secret',
          'Idempotency-Key': 'tingilin-direct-test',
        },
      },
    );
    expect(result).toMatchObject({
      id: 'direct-provider-id',
      status: 'payin_pending',
      transactionRef: 'IN123#250101120000',
      paymentWithTaxes: '5250',
    });
    expect(result.paymentLink).toBeUndefined();
  });

  it('falls back to hosted checkout when direct charge is disabled', async () => {
    const { service, post } = createService();
    post
      .mockReturnValueOnce(
        throwError(() => ({
          response: {
            status: 503,
            data: {
              statusCode: 503,
              code: 'DIRECT_CHARGE_DISABLED',
              message: 'Direct mobile-money charge is currently disabled.',
            },
          },
        })),
      )
      .mockReturnValueOnce(
        of({
          data: {
            id: 'hosted-provider-id',
            status: 'payin_pending',
            data: {
              transactionRef: 'IN123#250101120001',
              paymentLink:
                'https://checkout.flutterwave.com/v3/hosted/pay/fallback',
            },
          },
          headers: { 'content-type': 'application/json' },
        } as AxiosResponse),
      );

    const result = await service.createDirectCharge({
      amount: 5000,
      reason: 'Tingilin payment ABC123 x1',
      userEmail: 'user@example.com',
      userPhone: '237691224472',
      userCountry: 'Cameroon',
      senderName: 'Test User',
      paymentMethodCode: 'MTN',
      currency: 'XAF',
      idempotencyKey: 'tingilin-disabled-test',
    });

    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenNthCalledWith(
      2,
      'https://app.digikuntz.com/dev/transaction',
      {
        estimation: 5000,
        raisonForTransfer: 'Tingilin payment ABC123 x1',
        userEmail: 'user@example.com',
        userPhone: '691224472',
        userCountry: 'Cameroon',
        senderName: 'Test User',
        callbackUrl: 'https://tinguilin.yaba-in.com/tabs/participations',
      },
      {
        headers: {
          Accept: 'application/json',
          'x-user-id': 'account-user-id',
          'x-secret-key': 'SK-secret',
          'Idempotency-Key': 'tingilin-disabled-test',
        },
      },
    );
    expect(result).toMatchObject({
      id: 'hosted-provider-id',
      status: 'payin_pending',
      transactionRef: 'IN123#250101120001',
      paymentLink:
        'https://checkout.flutterwave.com/v3/hosted/pay/fallback',
      paymentFlow: 'HOSTED_CHECKOUT',
    });
  });

  it('falls back to hosted checkout after an explicit direct-charge validation rejection', async () => {
    const { service, post } = createService();
    post
      .mockReturnValueOnce(
        throwError(() => ({
          response: {
            status: 422,
            data: { message: 'Direct charge is unavailable for this operator' },
          },
        })),
      )
      .mockReturnValueOnce(
        of({
          data: {
            id: 'hosted-provider-id',
            status: 'payin_pending',
            data: {
              transactionRef: 'HOSTED-REF',
              paymentLink:
                'https://checkout.flutterwave.com/v3/hosted/pay/fallback',
            },
          },
          headers: { 'content-type': 'application/json' },
        } as AxiosResponse),
      );

    const result = await service.createDirectCharge({
      amount: 5000,
      reason: 'Tingilin payment ABC123 x1',
      userEmail: 'user@example.com',
      userPhone: '237691224472',
      userCountry: 'Cameroon',
      senderName: 'Test User',
      paymentMethodCode: 'ORANGEMONEY',
      currency: 'XAF',
      idempotencyKey: 'tingilin-rejection-test',
    });

    expect(post).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      id: 'hosted-provider-id',
      paymentFlow: 'HOSTED_CHECKOUT',
      paymentLink:
        'https://checkout.flutterwave.com/v3/hosted/pay/fallback',
    });
  });

  it('does not start a second payment after an ambiguous network failure', async () => {
    const { service, post, get } = createService();
    post.mockReturnValue(
      throwError(() => ({ code: 'ECONNRESET', message: 'socket hang up' })),
    );
    get.mockReturnValue(
      of({
        data: [],
        headers: { 'content-type': 'application/json' },
      } as AxiosResponse),
    );

    await expect(
      service.createDirectCharge({
        amount: 5000,
        reason: 'Tingilin payment ABC123 x1',
        userEmail: 'user@example.com',
        userPhone: '237691224472',
        userCountry: 'Cameroon',
        senderName: 'Test User',
        paymentMethodCode: 'MTN',
        currency: 'XAF',
        idempotencyKey: 'tingilin-ambiguous-test',
      }),
    ).rejects.toThrow('Digikuntz direct-charge failed');

    expect(post).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(2);
  });

  const directChargeInput = {
    amount: 5000,
    reason: 'Tingilin payment ABC123 x1',
    userEmail: 'user@example.com',
    userPhone: '237677123456',
    userCountry: 'Cameroon',
    senderName: 'Test User',
    paymentMethodCode: 'MTN' as const,
    currency: 'XAF' as const,
    idempotencyKey: 'tingilin-doc-test',
  };

  it('looks the payin up by id after an ambiguous 502 that carries the id (documented flow)', async () => {
    const { service, post, get } = createService();
    post.mockReturnValue(
      throwError(() => ({
        response: {
          status: 502,
          data: { id: '6af3b70df7bdee716adaa851', message: 'Upstream timeout' },
        },
      })),
    );
    get.mockReturnValue(
      of({
        data: {
          id: '6af3b70df7bdee716adaa851',
          status: 'payin_pending',
          data: { transactionRef: 'IN535#261111013004' },
        },
        headers: { 'content-type': 'application/json' },
      } as AxiosResponse),
    );

    const result = await service.createDirectCharge(directChargeInput);

    expect(post).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('https://app.digikuntz.com/dev/transaction', {
      headers: expect.any(Object),
      params: { transactionId: '6af3b70df7bdee716adaa851' },
    });
    expect(result).toMatchObject({
      id: '6af3b70df7bdee716adaa851',
      transactionRef: 'IN535#261111013004',
      paymentFlow: 'DIRECT_CHARGE',
    });
  });

  it('reports an in-progress idempotent request (409) as a conflict, not a refusal', async () => {
    const { service, post } = createService();
    post.mockReturnValue(
      throwError(() => ({
        response: {
          status: 409,
          data: {
            message: 'Request with this Idempotency-Key is still in progress',
          },
        },
      })),
    );

    await expect(service.createDirectCharge(directChargeInput)).rejects.toThrow(
      ConflictException,
    );
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('removes insecure checkout aliases from nested response data', async () => {
    const { service, post } = createService();
    post.mockReturnValue(
      of({
        data: {
          id: 'provider-id',
          status: 'payin_pending',
          data: {
            paymentLink: 'http://checkout.example.com/pay/test',
            payment_url: 'http://checkout.example.com/pay/alias',
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

    expect(result.paymentLink).toBeUndefined();
    expect(result.data?.paymentLink).toBeUndefined();
    expect(result.data?.payment_url).toBeUndefined();
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
          Accept: 'application/json',
          'x-user-id': 'account-user-id',
          'x-secret-key': 'SK-secret',
        },
        params: { transactionId: 'provider-id' },
      },
    );
    expect(result.status).toBe('payin_success');
  });

  it('normalizes deeply nested transaction envelopes and aliases', async () => {
    const { service, post } = createService();
    post.mockReturnValue(
      of({
        data: {
          status: 'success',
          result: {
            data: {
              transaction: {
                transaction_id: 'nested-provider-id',
                transaction_ref: 'NESTED-REF',
                payment_url: 'https://checkout.example.com/pay/nested',
                payment_with_taxes: 110,
                state: 'payin_pending',
              },
            },
          },
        },
      } as AxiosResponse),
    );

    const result = await service.createPayin({
      amount: 100,
      reason: 'Test nested response',
      userEmail: 'user@example.com',
      userPhone: '691224472',
      userCountry: 'Cameroon',
      senderName: 'Test User',
    });

    expect(result).toMatchObject({
      id: 'nested-provider-id',
      transactionRef: 'NESTED-REF',
      paymentLink: 'https://checkout.example.com/pay/nested',
      paymentWithTaxes: '110',
      status: 'payin_pending',
    });
  });

  it('rejects a non-HTTP payment link returned by the provider', async () => {
    const { service, post } = createService();
    post.mockReturnValue(
      of({
        data: {
          data: {
            id: 'provider-id',
            paymentLink: 'javascript:alert(1)',
          },
        },
      } as AxiosResponse),
    );

    const result = await service.createPayin({
      amount: 100,
      reason: 'Test unsafe link',
      userEmail: 'user@example.com',
      userPhone: '691224472',
      userCountry: 'Cameroon',
      senderName: 'Test User',
    });

    expect(result.paymentLink).toBeUndefined();
  });

  it('rejects an insecure HTTP payment link returned by the provider', async () => {
    const { service, post } = createService();
    post.mockReturnValue(
      of({
        data: {
          id: 'provider-id',
          paymentLink: 'http://checkout.example.com/pay/insecure',
        },
      } as AxiosResponse),
    );

    const result = await service.createPayin({
      amount: 100,
      reason: 'Test insecure link',
      userEmail: 'user@example.com',
      userPhone: '691224472',
      userCountry: 'Cameroon',
      senderName: 'Test User',
    });

    expect(result.paymentLink).toBeUndefined();
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

  it('derives the callback URL from PUBLIC_APP_URL', async () => {
    const { service, post } = createService({
      DIGIKUNTZ_CALLBACK_URL: '',
      PUBLIC_APP_URL: 'https://tinguilin.yaba-in.com/',
    });
    post.mockReturnValue(
      of({
        data: {
          id: 'provider-id',
          status: 'payin_pending',
          data: { paymentLink: 'https://checkout.example.com/pay/test' },
        },
      } as AxiosResponse),
    );

    await service.createPayin({
      amount: 100,
      reason: 'Test',
      userEmail: 'user@example.com',
      userPhone: '691224472',
      userCountry: 'Cameroon',
      senderName: 'Test User',
    });

    expect(post.mock.calls[0][1]).toMatchObject({
      callbackUrl: 'https://tinguilin.yaba-in.com/tabs/participations',
    });
  });

  it('rejects a non-HTTP callback URL before calling Digikuntz', () => {
    const { service, post } = createService({
      DIGIKUNTZ_CALLBACK_URL: 'javascript:alert(1)',
    });

    expect(() => service.assertConfigured()).toThrow(
      ServiceUnavailableException,
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects the Digikuntz web portal as API base URL', () => {
    const { service } = createService({
      DIGIKUNTZ_BASE_URL: 'https://payments.digikuntz.com/dev',
    });

    expect(() => service.assertConfigured()).toThrow(
      'DIGIKUNTZ_BASE_URL must be exactly https://app.digikuntz.com/dev',
    );
  });

  it('accepts JSON serialized as text by the provider', async () => {
    const { service, post } = createService();
    post.mockReturnValue(
      of({
        status: 201,
        data: JSON.stringify({
          id: 'provider-id',
          status: 'payin_pending',
          data: {
            transactionRef: 'TEXT-REF',
            paymentLink: 'https://checkout.example.com/pay/text',
          },
        }),
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      } as AxiosResponse),
    );

    const result = await service.createPayin({
      amount: 100,
      reason: 'Test text JSON response',
      userEmail: 'user@example.com',
      userPhone: '691224472',
      userCountry: 'Cameroon',
      senderName: 'Test User',
    });

    expect(result).toMatchObject({
      id: 'provider-id',
      transactionRef: 'TEXT-REF',
      paymentLink: 'https://checkout.example.com/pay/text',
    });
  });

  it('recovers a transaction from the documented list after a 201 HTML response', async () => {
    const { service, post, get } = createService();
    post.mockReturnValue(
      of({
        status: 201,
        data: '<!doctype html><html><body>checkout</body></html>',
        headers: { 'content-type': 'text/html; charset=utf-8' },
      } as AxiosResponse),
    );
    get
      .mockReturnValueOnce(
        of({
          data: {
            data: [
              {
                _id: 'provider-id',
                estimation: '100',
                raisonForTransfer: 'Tingilin payment RECOVER x1',
                transactionRef: 'RECOVER-REF',
                status: 'payin_pending',
              },
            ],
          },
        } as AxiosResponse),
      )
      .mockReturnValueOnce(
        of({
          data: {
            id: 'provider-id',
            status: 'payin_pending',
            data: {
              transactionRef: 'RECOVER-REF',
              paymentLink: 'https://checkout.example.com/pay/recovered',
            },
          },
        } as AxiosResponse),
      );

    const result = await service.createPayin({
      amount: 100,
      reason: 'Tingilin payment RECOVER x1',
      userEmail: 'user@example.com',
      userPhone: '691224472',
      userCountry: 'Cameroon',
      senderName: 'Test User',
    });

    expect(get).toHaveBeenNthCalledWith(
      1,
      'https://app.digikuntz.com/dev/transactions-list',
      {
        headers: {
          Accept: 'application/json',
          'x-user-id': 'account-user-id',
          'x-secret-key': 'SK-secret',
        },
        params: { page: 1, limit: 100 },
      },
    );
    expect(result).toMatchObject({
      id: 'provider-id',
      transactionRef: 'RECOVER-REF',
      paymentLink: 'https://checkout.example.com/pay/recovered',
    });
  });

  it('extracts a secure checkout URL when the 201 HTML response contains one', async () => {
    const { service, post, get } = createService();
    post.mockReturnValue(
      of({
        status: 201,
        data: `<!doctype html><html><body>
          <form method="post" action="https://checkout.flutterwave.com/v3/hosted/pay/abc123">
            <script src="https://cdn.example.com/payment.js"></script>
          </form>
        </body></html>`,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      } as AxiosResponse),
    );
    get.mockReturnValue(
      of({
        data: { data: [] },
        headers: { 'content-type': 'application/json' },
      } as AxiosResponse),
    );

    const result = await service.createPayin({
      amount: 100,
      reason: 'Tingilin payment HTMLLINK x1',
      userEmail: 'user@example.com',
      userPhone: '691224472',
      userCountry: 'Cameroon',
      senderName: 'Test User',
    });

    expect(result).toMatchObject({
      status: 'payin_pending',
      paymentLink: 'https://checkout.flutterwave.com/v3/hosted/pay/abc123',
    });
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('recognizes the documented direct-charge refusal response as hosted fallback', async () => {
    const { service, post } = createService();
    post.mockReturnValue(
      of({
        status: 201,
        data: {
          id: 'provider-id',
          status: 'payin_pending',
          data: {
            transactionRef: 'IN401#261111010055',
            txRef: 'txPayin-1794355268504-3258c0a6',
            paymentLink:
              'https://checkout.flutterwave.com/v3/hosted/pay/fallback',
            redirect_url:
              'https://checkout.flutterwave.com/v3/hosted/pay/fallback',
            chargeStatus: 'failed',
            fallback: { reason: 'DIRECT_CHARGE_REFUSED' },
          },
        },
      } as AxiosResponse),
    );

    const result = await service.createDirectCharge({
      amount: 5000,
      reason: 'Tingilin payment REFUSED1 x1',
      userEmail: 'user@example.com',
      userPhone: '237691224472',
      userCountry: 'Cameroon',
      senderName: 'Test User',
      paymentMethodCode: 'ORANGEMONEY',
      currency: 'XAF',
      idempotencyKey: 'tingilin-refused-test',
    });

    expect(result).toMatchObject({
      id: 'provider-id',
      transactionRef: 'IN401#261111010055',
      paymentFlow: 'HOSTED_CHECKOUT',
      paymentLink:
        'https://checkout.flutterwave.com/v3/hosted/pay/fallback',
    });
    expect(result.data?.redirect_url).toBeUndefined();
  });

  it('rejects an HTML response returned instead of the payment API JSON', async () => {
    const { service, post, get } = createService();
    post.mockReturnValue(
      of({
        data: '<!doctype html><html></html>',
        headers: { 'content-type': 'text/html' },
      } as AxiosResponse),
    );
    get.mockReturnValue(
      of({
        data: { data: [] },
        headers: { 'content-type': 'application/json' },
      } as AxiosResponse),
    );

    await expect(
      service.createPayin({
        amount: 100,
        reason: 'Test HTML response',
        userEmail: 'user@example.com',
        userPhone: '691224472',
        userCountry: 'Cameroon',
        senderName: 'Test User',
      }),
    ).rejects.toThrow('transaction could not be recovered');
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
