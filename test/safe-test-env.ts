const testMongoUri = String(process.env.TEST_MONGO_URI ?? '').trim();

if (!testMongoUri) {
  throw new Error(
    'TEST_MONGO_URI is required for e2e tests; production/development databases are never reused.',
  );
}

if (!/(^|[?&_.\-/])test([?&_.\-/]|$)/i.test(testMongoUri)) {
  throw new Error('TEST_MONGO_URI must clearly target an isolated test database.');
}

process.env.NODE_ENV = 'test';
process.env.MONGO_URI = testMongoUri;
process.env.ENABLE_RAFFLE_SCHEDULER = 'false';
