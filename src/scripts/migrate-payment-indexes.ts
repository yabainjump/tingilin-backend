import 'dotenv/config';
import mongoose from 'mongoose';
import { ensurePaymentIndexes } from '../modules/payments/payment-indexes';

const COLLECTION_NAME = 'transactions';

async function migratePaymentIndexes() {
  const mongoUri = String(process.env.MONGO_URI ?? '').trim();
  if (!mongoUri) throw new Error('MONGO_URI is required');

  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15_000 });
  const collection = mongoose.connection.collection(COLLECTION_NAME);
  await ensurePaymentIndexes(collection, console.log);
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
