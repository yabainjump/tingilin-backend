import 'dotenv/config';
import mongoose from 'mongoose';

const COLLECTION_NAME = 'transactions';

const desiredIndexes: Array<{
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

async function migratePaymentIndexes() {
  const mongoUri = String(process.env.MONGO_URI ?? '').trim();
  if (!mongoUri) throw new Error('MONGO_URI is required');

  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15_000 });
  const collection = mongoose.connection.collection(COLLECTION_NAME);

  let currentIndexes: Record<string, any>[] = [];
  try {
    currentIndexes = (await collection.indexes()) as Record<string, any>[];
  } catch (error: any) {
    if (Number(error?.code ?? 0) !== 26) throw error;
  }

  for (const desired of desiredIndexes) {
    const current = currentIndexes.find(
      (index) => index.name === desired.name || hasSameKey(index, desired.key),
    );
    if (
      current?.name === desired.name &&
      hasExpectedOptions(current, desired.optionalField, desired.unique)
    ) {
      console.log(`Payment index already valid: ${desired.name}`);
      continue;
    }

    if (current) {
      await collection.dropIndex(String(current.name));
      console.log(`Removed legacy payment index: ${String(current.name)}`);
    }

    await collection.createIndex(desired.key, {
      name: desired.name,
      unique: desired.unique,
      partialFilterExpression: {
        [desired.optionalField]: { $type: 'string' },
      },
    });
    console.log(`Created partial payment index: ${desired.name}`);
  }
}

migratePaymentIndexes()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Payment index migration failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
