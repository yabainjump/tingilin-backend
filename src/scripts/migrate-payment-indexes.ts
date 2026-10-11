import 'dotenv/config';
import mongoose from 'mongoose';
import {
  ensurePaymentIndexes,
  ensureTicketFulfillmentIndex,
} from '../modules/payments/payment-indexes';

const COLLECTION_NAME = 'transactions';

async function migratePaymentIndexes() {
  const mongoUri = String(process.env.MONGO_URI ?? '').trim();
  if (!mongoUri) throw new Error('MONGO_URI is required');

  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15_000 });
  const collection = mongoose.connection.collection(COLLECTION_NAME);
  await ensurePaymentIndexes(collection, console.log);
  await ensureTicketFulfillmentIndex(
    mongoose.connection.collection('tickets'),
    console.log,
  );
  await migrateUserIndexes(mongoose.connection, console.log);
}

/**
 * Le champ phone est devenu optionnel (comptes Google sans telephone).
 * L'ancien index phone_1 unique non-sparse doit etre remplace par une
 * version sparse pour autoriser plusieurs comptes sans telephone.
 */
async function migrateUserIndexes(
  connection: mongoose.Connection,
  log: (msg: string) => void,
) {
  const users = connection.collection('users');

  const existing = await users.indexes();
  const phoneIndex = existing.find((idx) => idx.name === 'phone_1');
  if (phoneIndex && !phoneIndex.sparse) {
    try {
      await users.dropIndex('phone_1');
      log('Dropped legacy unique non-sparse index phone_1');
    } catch (error) {
      log(`Could not drop phone_1 (continuing): ${String(error)}`);
    }
  }

  await users.createIndex(
    { phone: 1 },
    { unique: true, sparse: true, name: 'phone_1' },
  );
  log('User phone sparse unique index ensured');
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
