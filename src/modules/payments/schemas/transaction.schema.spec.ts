import { TransactionSchema } from './transaction.schema';

describe('TransactionSchema indexes', () => {
  it.each([
    ['providerTransactionId', { provider: 1, providerTransactionId: 1 }],
    ['providerRef', { provider: 1, providerRef: 1 }],
    ['idempotencyKey', { userId: 1, idempotencyKey: 1 }],
  ])(
    'only enforces uniqueness when %s is a string',
    (optionalField, expectedKeys) => {
      const index = TransactionSchema.indexes().find(
        ([keys]) => JSON.stringify(keys) === JSON.stringify(expectedKeys),
      );

      expect(index).toBeDefined();
      expect(index?.[1]).toMatchObject({
        unique: true,
        partialFilterExpression: {
          [optionalField]: { $type: 'string' },
        },
      });
      expect(index?.[1]).not.toHaveProperty('sparse');
    },
  );
});
