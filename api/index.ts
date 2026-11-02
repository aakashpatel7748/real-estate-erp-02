import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import { createApp } from '../apps/api/src/app';
import { connectDb } from '../apps/api/src/config/db';

const app = createApp();

let connectPromise: Promise<any> | null = null;

async function ensureDb() {
  if (mongoose.connection.readyState === 1) {
    return;
  }
  if (!connectPromise) {
    connectPromise = connectDb().catch((err) => {
      connectPromise = null;
      throw err;
    });
  }
  await connectPromise;
}

export default async function handler(req: Request, res: Response) {
  try {
    await ensureDb();
  } catch (err: any) {
    console.error('MongoDB serverless connection error:', err);
    return res.status(503).json({
      success: false,
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'Could not connect to MongoDB Atlas. Please verify MONGODB_URI in Vercel environment variables.',
        details: err?.message,
      },
    });
  }

  // Ensure request URL maintains the /api prefix so Express routers match accurately
  if (req.url && !req.url.startsWith('/api')) {
    req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
  }

  return app(req, res);
}

