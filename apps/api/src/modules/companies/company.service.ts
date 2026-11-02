import type { ClientSession, Types } from 'mongoose';
import { SYSTEM_ACCOUNTS, SYSTEM_ROLES, type CompanyUpdateInput } from '@erp/shared';
import { Company } from './company.model';
import { Role } from '../roles/role.models';
import { Account } from '../accounting/accounting.models';
import { Membership } from '../users/user.models';
import { notFound } from '../../utils/errors';
import { audit } from '../../utils/audit';
import type { TenantContext } from '../../utils/tenant';
import { randomToken } from '../../utils/crypto';

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `${base || 'company'}-${randomToken(4)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')}`;
}

/** Creates a company with its default roles, chart of accounts and the owner membership. */
export async function createCompanyWithDefaults(input: { name: string; ownerUserId: Types.ObjectId }, session: ClientSession) {
  const [company] = await Company.create([{ name: input.name, slug: slugify(input.name), createdBy: input.ownerUserId }], { session });
  const companyId = company!._id;

  const roles = await Role.create(
    Object.entries(SYSTEM_ROLES).map(([systemKey, r]) => ({
      companyId,
      systemKey,
      name: r.name,
      description: r.description,
      permissions: r.permissions,
      isSystem: true,
    })),
    { session, ordered: true },
  );

  await Account.create(
    SYSTEM_ACCOUNTS.map((a) => ({
      companyId,
      ...a,
      isBank: a.systemKey === 'bank',
      cashBankKind: a.systemKey === 'bank' ? 'bank' : a.systemKey === 'cash' ? 'cash' : undefined,
    })),
    { session, ordered: true },
  );

  const ownerRole = roles.find((r) => r.systemKey === 'owner')!;
  await Membership.create(
    [{ companyId, userId: input.ownerUserId, roleId: ownerRole._id, status: 'active', projectAccess: { mode: 'all' } }],
    {
      session,
    },
  );
  return company!;
}

export async function getCompany(ctx: TenantContext) {
  const company = await Company.findById(ctx.companyId).lean();
  if (!company) throw notFound('Company');
  return company;
}

export async function updateCompany(ctx: TenantContext, input: CompanyUpdateInput) {
  const set: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (k === 'settings' && v) {
      for (const [sk, sv] of Object.entries(v)) if (sv !== undefined) set[`settings.${sk}`] = sv;
    } else if (v !== undefined) set[k] = v;
  }
  const company = await Company.findByIdAndUpdate(ctx.companyId, { $set: set }, { new: true, runValidators: true }).lean();
  if (!company) throw notFound('Company');
  await audit(ctx, { action: 'company.update', entityType: 'company', entityId: ctx.companyId, changes: set });
  return company;
}
