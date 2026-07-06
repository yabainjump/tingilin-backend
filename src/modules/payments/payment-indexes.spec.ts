import { ensurePaymentIndexes, PAYMENT_INDEXES } from './payment-indexes';

describe('ensurePaymentIndexes', () => {
  it('replaces a unique providerRef index and verifies the final state', async () => {
    let indexes: Record<string, any>[] = PAYMENT_INDEXES.map((index) => ({
      name: index.name,
      key: index.key,
      unique: true,
      partialFilterExpression: {
        [index.optionalField]: { $type: 'string' },
      },
    }));
    const collection = {
      indexes: jest.fn(async () => indexes),
      dropIndex: jest.fn(async (name: string) => {
        indexes = indexes.filter((index) => index.name !== name);
      }),
      createIndex: jest.fn(async (key: Record<string, 1>, options: any) => {
        indexes.push({ key, ...options });
        return options.name;
      }),
    };

    await ensurePaymentIndexes(collection);

    expect(collection.dropIndex).toHaveBeenCalledWith(
      'provider_1_providerRef_1',
    );
    expect(collection.createIndex).toHaveBeenCalledWith(
      { provider: 1, providerRef: 1 },
      expect.objectContaining({ unique: false }),
    );
  });

  it('fails startup when an index does not match after creation', async () => {
    const collection = {
      indexes: jest.fn(async () => []),
      dropIndex: jest.fn(),
      createIndex: jest.fn(),
    };

    await expect(ensurePaymentIndexes(collection)).rejects.toThrow(
      'Payment index verification failed',
    );
  });
});
