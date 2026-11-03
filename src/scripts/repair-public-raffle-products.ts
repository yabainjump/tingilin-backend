import 'dotenv/config';
import mongoose from 'mongoose';

const PUBLIC_RAFFLE_STATUSES = ['LIVE', 'CLOSED', 'DRAWN'];

async function repairPublicRaffleProducts() {
  const mongoUri = String(process.env.MONGO_URI ?? '').trim();
  if (!mongoUri) throw new Error('MONGO_URI is required');

  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15_000 });
  const connection = mongoose.connection;
  const productIds = await connection
    .collection('raffles')
    .distinct('productId', {
      status: { $in: PUBLIC_RAFFLE_STATUSES },
      productId: { $type: 'objectId' },
    });

  if (productIds.length === 0) {
    console.log('No public raffle products to repair');
    return;
  }

  const result = await connection.collection('products').updateMany(
    {
      _id: { $in: productIds },
      status: { $ne: 'PUBLISHED' },
    },
    { $set: { status: 'PUBLISHED' } },
  );

  console.log(
    `Public raffle product repair complete: ${result.modifiedCount} product(s) published`,
  );
}

repairPublicRaffleProducts()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Public raffle product repair failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
