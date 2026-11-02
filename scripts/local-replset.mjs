#!/usr/bin/env node
/**
 * Starts a local single-node MongoDB replica set for development (transactions need one).
 * Requires `mongod` on PATH, or set MONGOD_BIN. Data lives in ./.data/db.
 *
 *   npm run db:local
 *
 * Alternatively use Docker:  docker compose up -d mongo
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Resolve the driver through the API workspace (it is a mongoose dependency).
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { MongoClient } = require('mongodb');

async function getBin() {
  if (process.env.MONGOD_BIN) return process.env.MONGOD_BIN;
  try {
    const { MongoBinary } = require('mongodb-memory-server');
    return await MongoBinary.getPath();
  } catch {
    return 'mongod';
  }
}

const bin = await getBin();
const port = Number(process.env.MONGO_PORT ?? 27017);
const dbPath = fileURLToPath(new URL('../.data/db', import.meta.url));
mkdirSync(dbPath, { recursive: true });

const child = spawn(bin, ['--replSet', 'rs0', '--port', String(port), '--dbpath', dbPath, '--bind_ip', '127.0.0.1'], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));

async function initiate() {
  for (let i = 0; i < 30; i++) {
    try {
      const client = await MongoClient.connect(`mongodb://127.0.0.1:${port}/?directConnection=true`);
      const admin = client.db('admin');
      try {
        await admin.command({ replSetGetStatus: 1 });
      } catch {
        await admin.command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: `127.0.0.1:${port}` }] } });
        console.log('Replica set rs0 initiated');
      }
      await client.close();
      console.log(`MongoDB replica set ready: mongodb://127.0.0.1:${port}/real_estate_erp?replicaSet=rs0`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  console.error('Could not initiate the replica set');
}
initiate();

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
