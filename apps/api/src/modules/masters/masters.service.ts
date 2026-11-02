import { Types } from 'mongoose';
import { applyBasisPoints, formatINR, priceForArea, type ParkingSlotInput } from '@erp/shared';
import { audit } from '../../utils/audit';
import { badRequest, businessRule, conflict, notFound } from '../../utils/errors';
import { escapeRegex, pageMeta, parseSort } from '../../utils/http';
import { assertProjectAccess, scopedFilter, toObjectId, type TenantContext } from '../../utils/tenant';
import { Booking } from '../bookings/booking.models';
import { Plot } from '../plots/plot.models';
import { computeListPrice } from '../plots/plots.service';
import { Block, Project, ProjectPhase } from '../projects/project.models';
import { ChargeMaster, ParkingSlot, RateIndex } from './masters.models';

type Row = Record<string, unknown> & { _id: Types.ObjectId };

// ---------------- Financers ----------------

export async function enrichFinancers(ctx: TenantContext, rows: Row[]) {
  const ids = rows.map((r) => r._id);
  const stats = await Booking.aggregate<{ _id: Types.ObjectId; count: number; sanctioned: number; disbursed: number }>([
    { $match: { companyId: ctx.companyId, 'loan.financerId': { $in: ids }, status: { $in: ['reserved', 'booked'] } } },
    {
      $group: {
        _id: '$loan.financerId',
        count: { $sum: 1 },
        sanctioned: { $sum: { $ifNull: ['$loan.sanctionedPaise', 0] } },
        disbursed: { $sum: { $ifNull: ['$loan.disbursedPaise', 0] } },
      },
    },
  ]);
  const byId = new Map(stats.map((s) => [String(s._id), s]));
  return rows.map((r) => {
    const s = byId.get(String(r._id));
    return { ...r, loans: s?.count ?? 0, sanctionedPaise: s?.sanctioned ?? 0, disbursedPaise: s?.disbursed ?? 0 };
  });
}

export async function financerDetail(ctx: TenantContext, doc: Row) {
  const filter = { ...scopedFilter(ctx), 'loan.financerId': doc._id };
  const bookings = await Booking.find(filter)
    .sort({ bookingDate: -1 })
    .limit(200)
    .select('bookingNumber status bookingDate netAmountPaise receivedPaise loan customerId projectId')
    .populate({ path: 'customerId', select: 'name phone', match: { companyId: ctx.companyId } })
    .populate({ path: 'projectId', select: 'name code', match: { companyId: ctx.companyId } })
    .lean();
  return { ...doc, bookings };
}

// ---------------- Charges ----------------

/** Prices the active charges of a project for the selected units (fixed, per sq ft or % of unit value). */
export async function computeCharges(ctx: TenantContext, projectId: string, plotIds: string[]) {
  assertProjectAccess(ctx, projectId);
  const pid = toObjectId(projectId);
  const plots = plotIds.length
    ? await Plot.find({ companyId: ctx.companyId, projectId: pid, _id: { $in: plotIds.map(toObjectId) } })
        .select('areaX100 ratePaisePerSqft plcBp')
        .lean()
    : [];
  const areaX100 = plots.reduce((s, p) => s + p.areaX100, 0);
  const valuePaise = plots.reduce((s, p) => {
    const base = priceForArea(p.areaX100, p.ratePaisePerSqft);
    return s + base + applyBasisPoints(base, p.plcBp);
  }, 0);
  const charges = await ChargeMaster.find({ companyId: ctx.companyId, deletedAt: null, isActive: true, projectId: { $in: [pid, null] } })
    .sort({ kind: 1, name: 1 })
    .lean();
  return charges.map((c) => {
    const base =
      c.basis === 'fixed'
        ? c.value * Math.max(plots.length, 1)
        : c.basis === 'per_sqft'
          ? priceForArea(areaX100, c.value)
          : applyBasisPoints(valuePaise, c.value);
    const gstPaise = applyBasisPoints(base, c.gstBp ?? 0);
    return {
      id: String(c._id),
      name: c.gstBp ? `${c.name} (incl. GST)` : c.name,
      kind: c.kind,
      basis: c.basis,
      isMandatory: c.isMandatory,
      amountPaise: base + gstPaise,
      basePaise: base,
      gstPaise,
    };
  });
}

// ---------------- Rate indexes ----------------

/**
 * Applies a rate card to matching units that are not commercially locked (available or blocked).
 * Reserved, booked and sold units keep their booked price. `dryRun` only counts.
 */
export async function applyRateIndex(ctx: TenantContext, id: string, dryRun: boolean) {
  const idx = await RateIndex.findOne({ companyId: ctx.companyId, deletedAt: null, _id: toObjectId(id) }).lean();
  if (!idx) throw notFound('Rate index');
  assertProjectAccess(ctx, idx.projectId);
  const filter: Record<string, unknown> = {
    companyId: ctx.companyId,
    projectId: idx.projectId,
    deletedAt: null,
    status: { $in: ['available', 'blocked'] },
  };
  if (idx.phaseId) filter.phaseId = idx.phaseId;
  if (idx.blockId) filter.blockId = idx.blockId;
  if (idx.unitType) filter.unitType = idx.unitType;
  if (idx.category) filter.category = idx.category;
  const plots = await Plot.find(filter).select('areaX100 ratePaisePerSqft plcBp listPricePaise').lean();
  const changes = plots.map((p) => {
    const plcBp = idx.plcBp ?? p.plcBp;
    return { id: p._id, plcBp, before: p.listPricePaise, after: computeListPrice(p.areaX100, idx.ratePaisePerSqft, plcBp) };
  });
  const summary = {
    units: changes.length,
    valueBeforePaise: changes.reduce((s, c) => s + c.before, 0),
    valueAfterPaise: changes.reduce((s, c) => s + c.after, 0),
  };
  if (dryRun || !changes.length) return { ...summary, applied: false };
  await Plot.bulkWrite(
    changes.map((c) => ({
      updateOne: {
        filter: { companyId: ctx.companyId, _id: c.id, status: { $in: ['available', 'blocked'] } },
        update: { $set: { ratePaisePerSqft: idx.ratePaisePerSqft, plcBp: c.plcBp, listPricePaise: c.after } },
      },
    })),
  );
  await RateIndex.updateOne(
    { companyId: ctx.companyId, _id: idx._id },
    { $push: { applications: { at: new Date(), by: ctx.userId, unitsRepriced: changes.length } } },
  );
  await audit(ctx, {
    action: 'rate_index.apply',
    entityType: 'rate_index',
    entityId: idx._id,
    summary: `${idx.name}: ${changes.length} units repriced to ${formatINR(idx.ratePaisePerSqft)}/sq ft`,
  });
  return { ...summary, applied: true };
}

// ---------------- Parking ----------------

export async function listParking(
  ctx: TenantContext,
  q: { page: number; pageSize: number; sort?: string; q?: string; projectId?: string; status?: string; type?: string },
) {
  const filter = scopedFilter(ctx, q.projectId);
  const base = { ...filter };
  if (q.status) filter.status = q.status;
  if (q.type) filter.type = q.type;
  if (q.q) filter.code = new RegExp(escapeRegex(q.q), 'i');
  const sort = parseSort(q.sort, ['code', 'type', 'status', 'pricePaise', 'createdAt'], { code: 1 });
  const [items, total, counts] = await Promise.all([
    ParkingSlot.find(filter)
      .collation({ locale: 'en', numericOrdering: true })
      .sort(sort)
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .select('-history')
      .populate({ path: 'projectId', select: 'name code', match: { companyId: ctx.companyId } })
      .populate({ path: 'blockId', select: 'name code', match: { companyId: ctx.companyId } })
      .populate({ path: 'bookingId', select: 'bookingNumber status', match: { companyId: ctx.companyId } })
      .populate({ path: 'customerId', select: 'name phone', match: { companyId: ctx.companyId } })
      .lean(),
    ParkingSlot.countDocuments(filter),
    ParkingSlot.aggregate<{ _id: string; n: number }>([{ $match: base }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);
  const summary = { available: 0, allotted: 0, blocked: 0, total: 0 } as Record<string, number>;
  for (const c of counts) {
    summary[c._id] = c.n;
    summary.total! += c.n;
  }
  return { items, meta: pageMeta(q.page, q.pageSize, total), summary };
}

async function checkParkingRefs(ctx: TenantContext, projectId: string | Types.ObjectId, blockId?: string | null) {
  assertProjectAccess(ctx, projectId);
  const pid = toObjectId(projectId);
  if (!(await Project.exists({ companyId: ctx.companyId, _id: pid }))) throw badRequest('Project not found');
  if (blockId && !(await Block.exists({ companyId: ctx.companyId, projectId: pid, _id: toObjectId(blockId) }))) {
    throw badRequest('Tower / block does not belong to this project');
  }
  return pid;
}

function duplicate(err: unknown) {
  return (err as { code?: number }).code === 11000;
}

export async function createParking(ctx: TenantContext, input: ParkingSlotInput) {
  const projectId = await checkParkingRefs(ctx, input.projectId, input.blockId);
  try {
    const slot = await ParkingSlot.create({
      ...input,
      companyId: ctx.companyId,
      projectId,
      history: [{ action: 'created', by: ctx.userId }],
    });
    await audit(ctx, { action: 'parking.create', entityType: 'parking', entityId: slot._id, summary: slot.code });
    return slot.toJSON();
  } catch (err) {
    if (duplicate(err)) throw conflict(`Slot ${input.code} already exists in this project`);
    throw err;
  }
}

export async function bulkCreateParking(
  ctx: TenantContext,
  input: Omit<ParkingSlotInput, 'code'> & { prefix: string; startNumber: number; count: number },
) {
  const projectId = await checkParkingRefs(ctx, input.projectId, input.blockId);
  const { prefix, startNumber, count, ...rest } = input;
  const docs = Array.from({ length: count }, (_, i) => ({
    ...rest,
    companyId: ctx.companyId,
    projectId,
    blockId: rest.blockId ? toObjectId(rest.blockId) : undefined,
    code: `${prefix}${startNumber + i}`,
    history: [{ action: 'created', by: ctx.userId }],
  }));
  try {
    await ParkingSlot.insertMany(docs, { ordered: true });
  } catch (err) {
    if (duplicate(err)) throw conflict('Some slot codes already exist in this project; choose another starting number');
    throw err;
  }
  await audit(ctx, { action: 'parking.bulk_create', entityType: 'project', entityId: projectId, summary: `${count} parking slots` });
  return { created: count };
}

async function loadSlot(ctx: TenantContext, id: string) {
  const slot = await ParkingSlot.findOne({ companyId: ctx.companyId, _id: toObjectId(id) });
  if (!slot) throw notFound('Parking slot');
  assertProjectAccess(ctx, slot.projectId);
  return slot;
}

export async function updateParking(ctx: TenantContext, id: string, input: Partial<ParkingSlotInput>) {
  const slot = await loadSlot(ctx, id);
  if (input.blockId) await checkParkingRefs(ctx, slot.projectId, input.blockId);
  slot.set(input);
  try {
    await slot.save();
  } catch (err) {
    if (duplicate(err)) throw conflict(`Slot ${input.code} already exists in this project`);
    throw err;
  }
  await audit(ctx, { action: 'parking.update', entityType: 'parking', entityId: slot._id, changes: input });
  return slot.toJSON();
}

/** Allots a slot to an active booking in the same project. Conditional on the slot still being free. */
export async function allotParking(ctx: TenantContext, id: string, input: { bookingId: string; remarks?: string }) {
  const slot = await loadSlot(ctx, id);
  const booking = await Booking.findOne({ companyId: ctx.companyId, _id: toObjectId(input.bookingId) })
    .select('projectId status bookingNumber customerId')
    .lean();
  if (!booking || String(booking.projectId) !== String(slot.projectId)) throw badRequest('Choose a booking in the same project');
  if (!['reserved', 'booked'].includes(booking.status)) throw businessRule(`Parking cannot be allotted to a ${booking.status} booking`);
  const res = await ParkingSlot.updateOne(
    { companyId: ctx.companyId, _id: slot._id, status: 'available' },
    {
      $set: { status: 'allotted', bookingId: booking._id, customerId: booking.customerId, allottedAt: new Date() },
      $push: { history: { action: 'allotted', bookingId: booking._id, note: input.remarks, by: ctx.userId } },
    },
  );
  if (res.modifiedCount !== 1) throw conflict(`Slot ${slot.code} is not available`);
  await audit(ctx, {
    action: 'parking.allot',
    entityType: 'parking',
    entityId: slot._id,
    summary: `${slot.code} → ${booking.bookingNumber}`,
  });
  return { id: String(slot._id), status: 'allotted' };
}

export async function releaseParking(ctx: TenantContext, id: string, note: string) {
  const slot = await loadSlot(ctx, id);
  const res = await ParkingSlot.updateOne(
    { companyId: ctx.companyId, _id: slot._id, status: 'allotted' },
    {
      $set: { status: 'available', bookingId: null, customerId: null, allottedAt: null },
      $push: { history: { action: 'released', bookingId: slot.bookingId, note, by: ctx.userId } },
    },
  );
  if (res.modifiedCount !== 1) throw businessRule('Only allotted slots can be released');
  await audit(ctx, { action: 'parking.release', entityType: 'parking', entityId: slot._id, summary: slot.code, changes: { note } });
  return { id: String(slot._id), status: 'available' };
}

export async function blockParking(ctx: TenantContext, id: string, blocked: boolean, note: string) {
  const slot = await loadSlot(ctx, id);
  const from = blocked ? 'available' : 'blocked';
  const to = blocked ? 'blocked' : 'available';
  const res = await ParkingSlot.updateOne(
    { companyId: ctx.companyId, _id: slot._id, status: from },
    { $set: { status: to }, $push: { history: { action: to === 'blocked' ? 'blocked' : 'unblocked', note, by: ctx.userId } } },
  );
  if (res.modifiedCount !== 1) throw businessRule(`Only ${from} slots can be ${blocked ? 'blocked' : 'unblocked'}`);
  return { id: String(slot._id), status: to };
}

export async function deleteParking(ctx: TenantContext, id: string) {
  const slot = await loadSlot(ctx, id);
  if (slot.status === 'allotted') throw businessRule('Release the slot before deleting it');
  await ParkingSlot.deleteOne({ companyId: ctx.companyId, _id: slot._id });
  await audit(ctx, { action: 'parking.delete', entityType: 'parking', entityId: slot._id, summary: slot.code });
}

// ---------------- Phases / towers ----------------

/** Phases and towers/blocks across projects, with unit counts by status. */
export async function projectStructure(ctx: TenantContext, projectId?: string) {
  const filter = scopedFilter(ctx, projectId);
  const projectFilter: Record<string, unknown> = { companyId: ctx.companyId, archivedAt: null };
  if (projectId) projectFilter._id = toObjectId(projectId);
  else if (ctx.projectScope !== null) projectFilter._id = { $in: ctx.projectScope };
  const [projects, phases, blocks, counts] = await Promise.all([
    Project.find(projectFilter).select('name code status').sort({ name: 1 }).lean(),
    ProjectPhase.find(filter).sort({ sequence: 1, code: 1 }).lean(),
    Block.find(filter).sort({ code: 1 }).lean(),
    Plot.aggregate<{ _id: { block: Types.ObjectId | null; phase: Types.ObjectId | null; status: string }; n: number }>([
      { $match: { ...filter, deletedAt: null } },
      { $group: { _id: { block: '$blockId', phase: '$phaseId', status: '$status' }, n: { $sum: 1 } } },
    ]),
  ]);
  const tally = (key: 'block' | 'phase', id: Types.ObjectId) => {
    const out: Record<string, number> = { total: 0 };
    for (const c of counts) {
      if (String(c._id[key]) !== String(id)) continue;
      out[c._id.status] = (out[c._id.status] ?? 0) + c.n;
      out.total! += c.n;
    }
    return out;
  };
  return projects.map((p) => ({
    ...p,
    phases: phases.filter((ph) => String(ph.projectId) === String(p._id)).map((ph) => ({ ...ph, units: tally('phase', ph._id) })),
    blocks: blocks.filter((b) => String(b.projectId) === String(p._id)).map((b) => ({ ...b, units: tally('block', b._id) })),
  }));
}
