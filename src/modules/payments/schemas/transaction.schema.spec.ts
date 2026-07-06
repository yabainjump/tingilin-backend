import { TransactionSchema } from './transaction.schema';

describe('TransactionSchema indexes', () => {
  it.each([
    ['providerTransactionId', { provider: 1, providerTransactionId: 1 }, true],
    ['providerRef', { provider: 1, providerRef: 1 }, false],
    ['idempotencyKey', { userId: 1, idempotencyKey: 1 }, true],
  ])(
    'configures the optional %s index safely',
    (optionalField, expectedKeys, expectedUnique) => {
      const index = TransactionSchema.indexes().find(
        ([keys]) => JSON.stringify(keys) === JSON.stringify(expectedKeys),
      );

      expect(index).toBeDefined();
      expect(index?.[1]).toMatchObject({
        partialFilterExpression: {
          [optionalField]: { $type: 'string' },
        },
      });
      expect(index?.[1].unique === true).toBe(expectedUnique);
      expect(index?.[1]).not.toHaveProperty('sparse');
    },
  );
});
