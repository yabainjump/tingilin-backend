export const PAYMENT_INDEXES: Array<{
  name: string;
  key: Record<string, 1>;
  optionalField: string;
  unique: boolean;
}> = [
  {
    name: 'provider_1_providerTransactionId_1',
    key: { provider: 1, providerTransactionId: 1 },
    optionalField: 'providerTransactionId',
    unique: true,
  },
  {
    name: 'provider_1_providerRef_1',
    key: { provider: 1, providerRef: 1 },
    optionalField: 'providerRef',
    unique: false,
  },
  {
    name: 'userId_1_idempotencyKey_1',
    key: { userId: 1, idempotencyKey: 1 },
    optionalField: 'idempotencyKey',
    unique: true,
  },
];

type PaymentIndexCollection = {
  indexes(): Promise<Record<string, any>[]>;
  dropIndex(name: string): Promise<unknown>;
  createIndex(
    key: Record<string, 1>,
    options: Record<string, unknown>,
  ): Promise<unknown>;
};

function hasExpectedOptions(
  index: Record<string, any>,
  optionalField: string,
  unique: boolean,
) {
  return (
    (index.unique === true) === unique &&
    index.sparse !== true &&
    index.partialFilterExpression?.[optionalField]?.$type === 'string'
  );
}

function hasSameKey(index: Record<string, any>, key: Record<string, 1>) {
  return JSON.stringify(index.key ?? {}) === JSON.stringify(key);
}

async function readIndexes(collection: PaymentIndexCollection) {
  try {
    return await collection.indexes();
  } catch (error: any) {
    if (Number(error?.code ?? 0) === 26) return [];
    throw error;
  }
}

export async function ensurePaymentIndexes(
  collection: PaymentIndexCollection,
  log: (message: string) => void = () => undefined,
) {
  let currentIndexes = await readIndexes(collection);

  for (const desired of PAYMENT_INDEXES) {
    const current = currentIndexes.find(
      (index) => index.name === desired.name || hasSameKey(index, desired.key),
    );
    if (
      current?.name === desired.name &&
      hasExpectedOptions(current, desired.optionalField, desired.unique)
    ) {
      log(`Payment index already valid: ${desired.name}`);
      continue;
    }

    if (current) {
      await collection.dropIndex(String(current.name));
      log(`Removed legacy payment index: ${String(current.name)}`);
    }

    await collection.createIndex(desired.key, {
      name: desired.name,
      unique: desired.unique,
      partialFilterExpression: {
        [desired.optionalField]: { $type: 'string' },
      },
    });
    log(`Created payment index: ${desired.name}`);
    currentIndexes = await readIndexes(collection);
  }

  const verifiedIndexes = await readIndexes(collection);
  for (const desired of PAYMENT_INDEXES) {
    const actual = verifiedIndexes.find(
      (index) => index.name === desired.name && hasSameKey(index, desired.key),
    );
    if (
      !actual ||
      !hasExpectedOptions(actual, desired.optionalField, desired.unique)
    ) {
      throw new Error(`Payment index verification failed: ${desired.name}`);
    }
  }
}
