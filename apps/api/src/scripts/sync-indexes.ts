/**
 * Builds/updates all MongoDB indexes and upgrades system roles with permissions introduced in
 * later releases. Production runs with autoIndex off, so run this in every release job:
 *   node apps/api/dist/scripts/sync-indexes.js
 */
import mongoose from 'mongoose';
import { SYSTEM_ROLES, type Permission } from '@erp/shared';
import { connectDb } from '../config/db';
import '../models';
import { Role } from '../modules/roles/role.models';

/**
 * Permissions added after the first release. Existing system roles receive the ones in their
 * default set; permissions an admin removed earlier are not touched.
 */
const ADDED_PERMISSIONS: Permission[] = [
  'crm.configure',
  'quotations.read',
  'quotations.create',
  'quotations.update',
  'accounting.adjust',
  'pdc.read',
  'pdc.create',
  'pdc.update',
  'postSales.read',
  'postSales.create',
  'postSales.update',
  'collections.read',
  'collections.create',
  'masters.read',
  'masters.create',
  'masters.update',
  'masters.delete',
];

async function upgradeSystemRoles() {
  for (const [key, def] of Object.entries(SYSTEM_ROLES)) {
    const add = ADDED_PERMISSIONS.filter((p) => def.permissions.includes(p));
    if (!add.length) continue;
    const res = await Role.updateMany({ systemKey: key }, { $addToSet: { permissions: { $each: add } } }, { crossTenant: true } as never);
    console.log(`Role ${key}: ${res.modifiedCount} updated`);
  }
}

async function main() {
  await connectDb();
  for (const model of Object.values(mongoose.models)) {
    const dropped = await model.syncIndexes();
    console.log(`${model.modelName}: indexes in sync${dropped.length ? ` (dropped ${dropped.join(', ')})` : ''}`);
  }
  await upgradeSystemRoles();
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
