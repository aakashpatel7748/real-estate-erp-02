import mongoose from 'mongoose';
import { logger } from '../utils/logger';
import { env } from './env';

mongoose.set('strictQuery', true);
// Enable autoIndex so indexes are automatically created even on serverless deployments
mongoose.set('autoIndex', true);

let isConnecting: Promise<typeof mongoose> | null = null;

export async function connectDb(uri = env.MONGODB_URI): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }
  if (isConnecting) {
    return isConnecting;
  }

  isConnecting = (async () => {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10_000,
      dbName: 'real_estate_erp',
    });
    await assertTransactionsSupported();
    logger.info({ db: conn.connection.name }, 'MongoDB connected');
    return conn;
  })().finally(() => {
    isConnecting = null;
  });

  return isConnecting;
}

/** Multi-document transactions require a replica set or sharded cluster. Fail fast otherwise. */
export async function assertTransactionsSupported(): Promise<void> {
  try {
    const db = mongoose.connection.db;
    if (!db) return;
    let hello: any;
    try {
      hello = await db.command({ hello: 1 });
    } catch {
      hello = await db.admin().command({ hello: 1 });
    }
    if (hello && !hello.setName && hello.msg !== 'isdbgrid') {
      logger.warn('MongoDB does not report replica set setName; multi-document transactions may not work.');
    }
  } catch (err) {
    logger.warn({ err }, 'Could not assert replica set support, proceeding anyway');
  }
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}
