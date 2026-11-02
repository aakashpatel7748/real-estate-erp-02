import { Types, type ClientSession } from 'mongoose';
import { applyBasisPoints, MANUAL_PLOT_TRANSITIONS, priceForArea, type BulkPlotInput, type PlotInput, type PlotStatus } from '@erp/shared';
import { withTransaction } from '../../db/transaction';
import { audit } from '../../utils/audit';
import { badRequest, businessRule, notFound } from '../../utils/errors';
import { escapeRegex, pageMeta, parseSort } from '../../utils/http';
import { assertProjectAccess, toObjectId, type TenantContext } from '../../utils/tenant';
import { Booking, BookingItem } from '../bookings/booking.models';
import { Block, Project, ProjectPhase } from '../projects/project.models';
import { Plot, PlotStatusHistory } from './plot.models';

export function computeListPrice(areaX100: number, ratePaisePerSqft: number, plcBp: number) {
  const base = priceForArea(areaX100, ratePaisePerSqft);
  return base + applyBasisPoints(base, plcBp);
}

async function requireProject(ctx: TenantContext, projectId: string) {
  assertProjectAccess(ctx, projectId);
  const project = await Project.findOne({ companyId: ctx.companyId, _id: toObjectId(projectId) })
    .select('status map')
    .lean();
  if (!project) throw notFound('Project');
  return project;
}

/** Validates that phase/block references belong to the same company and project. */
async function resolveHierarchy(ctx: TenantContext, projectId: Types.ObjectId, phaseId?: string | null, blockId?: string | null) {
  let phase: Types.ObjectId | null = phaseId ? toObjectId(phaseId) : null;
  let block: Types.ObjectId | null = null;
  if (phase && !(await ProjectPhase.exists({ companyId: ctx.companyId, projectId, _id: phase }))) {
    throw badRequest('Phase does not belong to this project');
  }
  if (blockId) {
    const b = await Block.findOne({ companyId: ctx.companyId, projectId, _id: toObjectId(blockId) })
      .select('phaseId')
      .lean();
    if (!b) throw badRequest('Block does not belong to this project');
    if (phase && b.phaseId && String(b.phaseId) !== String(phase)) throw badRequest('Block belongs to a different phase');
    block = b._id;
    phase = phase ?? b.phaseId ?? null;
  }
  return { phaseId: phase, blockId: block };
}

export async function recordPlotStatus(
  ctx: Pick<TenantContext, 'companyId' | 'userId'>,
  entry: {
    projectId: Types.ObjectId;
    plotId: Types.ObjectId;
    from: PlotStatus | null;
    to: PlotStatus;
    reason: string;
    bookingId?: Types.ObjectId;
  },
  session?: ClientSession,
) {
  await PlotStatusHistory.create([{ companyId: ctx.companyId, actorId: ctx.userId, ...entry }], { session });
}

export interface PlotListQuery {
  page: number;
  pageSize: number;
  sort?: string;
  q?: string;
  status?: string;
  phaseId?: string;
  blockId?: string;
  category?: string;
  unitType?: string;
}

export async function listPlots(ctx: TenantContext, projectId: string, q: PlotListQuery) {
  await requireProject(ctx, projectId);
  const filter: Record<string, unknown> = { companyId: ctx.companyId, projectId: toObjectId(projectId), deletedAt: null };
  if (q.status) filter.status = q.status;
  if (q.phaseId) filter.phaseId = toObjectId(q.phaseId);
  if (q.blockId) filter.blockId = toObjectId(q.blockId);
  if (q.category) filter.category = q.category;
  if (q.unitType) filter.unitType = q.unitType;
  if (q.q) filter.plotNumber = new RegExp(escapeRegex(q.q.toUpperCase()));
  let sort = parseSort(q.sort, ['plotNumber', 'areaX100', 'listPricePaise', 'status', 'createdAt', 'ratePaisePerSqft'], {
    plotNumber: 1,
  });
  // Plot numbers repeat across blocks, so order by block first (A-1, A-2 … B-1).
  if (sort.plotNumber) sort = { blockId: sort.plotNumber, plotNumber: sort.plotNumber, _id: sort.plotNumber };
  const [items, total, blocks] = await Promise.all([
    Plot.find(filter)
      .collation({ locale: 'en', numericOrdering: true })
      .sort(sort)
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .select('-mapShape')
      .lean(),
    Plot.countDocuments(filter),
    Block.find({ companyId: ctx.companyId, projectId: toObjectId(projectId) })
      .select('code name')
      .lean(),
  ]);
  const blockCode = new Map(blocks.map((b) => [String(b._id), b.code]));
  return {
    items: items.map((p) => ({ ...p, id: String(p._id), blockCode: p.blockId ? blockCode.get(String(p.blockId)) : undefined })),
    meta: pageMeta(q.page, q.pageSize, total),
  };
}

export async function getPlot(ctx: TenantContext, projectId: string, plotId: string) {
  await requireProject(ctx, projectId);
  const plot = await Plot.findOne({ companyId: ctx.companyId, projectId: toObjectId(projectId), _id: toObjectId(plotId) }).lean();
  if (!plot) throw notFound('Plot');
  const [history, booking, block] = await Promise.all([
    PlotStatusHistory.find({ companyId: ctx.companyId, plotId: plot._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('actorId', 'name')
      .lean(),
    plot.currentBookingId
      ? Booking.findOne({ companyId: ctx.companyId, _id: plot.currentBookingId })
          .select('bookingNumber status customerId netAmountPaise allocatedPaise reservedUntil')
          .populate({ path: 'customerId', select: 'name phone customerCode', match: { companyId: ctx.companyId } })
          .lean()
      : null,
    plot.blockId ? Block.findOne({ companyId: ctx.companyId, _id: plot.blockId }).select('code name').lean() : null,
  ]);
  return { ...plot, id: String(plot._id), blockCode: block?.code, history, currentBooking: booking };
}

export async function createPlot(ctx: TenantContext, projectId: string, input: PlotInput) {
  const project = await requireProject(ctx, projectId);
  if (project.status === 'archived') throw businessRule('Project is archived');
  const pid = toObjectId(projectId);
  const hierarchy = await resolveHierarchy(ctx, pid, input.phaseId, input.blockId);
  return withTransaction(async (session) => {
    const [plot] = await Plot.create(
      [
        {
          companyId: ctx.companyId,
          projectId: pid,
          ...input,
          ...hierarchy,
          listPricePaise: computeListPrice(input.areaX100, input.ratePaisePerSqft, input.plcBp),
          status: 'available',
        },
      ],
      { session },
    );
    await recordPlotStatus(ctx, { projectId: pid, plotId: plot!._id, from: null, to: 'available', reason: 'Plot created' }, session);
    await audit(ctx, { action: 'inventory.create', entityType: 'plot', entityId: plot!._id, summary: plot!.plotNumber }, session);
    return plot!.toJSON();
  });
}

export async function bulkCreatePlots(ctx: TenantContext, projectId: string, input: BulkPlotInput) {
  const project = await requireProject(ctx, projectId);
  if (project.status === 'archived') throw businessRule('Project is archived');
  const pid = toObjectId(projectId);
  const hierarchy = await resolveHierarchy(ctx, pid, input.phaseId, input.blockId);
  const listPricePaise = computeListPrice(input.areaX100, input.ratePaisePerSqft, input.plcBp);
  const docs = Array.from({ length: input.count }, (_, i) => ({
    _id: new Types.ObjectId(),
    companyId: ctx.companyId,
    projectId: pid,
    ...hierarchy,
    plotNumber: `${input.prefix}${input.startNumber + i}`,
    category: input.category,
    unitType: input.unitType,
    floor: input.floor,
    configuration: input.configuration,
    areaX100: input.areaX100,
    ratePaisePerSqft: input.ratePaisePerSqft,
    plcBp: input.plcBp,
    listPricePaise,
    status: 'available' as const,
  }));
  return withTransaction(async (session) => {
    await Plot.insertMany(docs, { session, ordered: true });
    await PlotStatusHistory.insertMany(
      docs.map((d) => ({
        companyId: ctx.companyId,
        projectId: pid,
        plotId: d._id,
        from: null,
        to: 'available',
        reason: 'Bulk created',
        actorId: ctx.userId,
      })),
      { session },
    );
    await audit(
      ctx,
      { action: 'inventory.bulk_create', entityType: 'project', entityId: pid, summary: `${docs.length} plots created` },
      session,
    );
    return { created: docs.length };
  });
}

const PRICE_FIELDS = ['areaX100', 'ratePaisePerSqft', 'plcBp'] as const;

export async function updatePlot(ctx: TenantContext, projectId: string, plotId: string, input: Partial<PlotInput>) {
  await requireProject(ctx, projectId);
  const pid = toObjectId(projectId);
  const plot = await Plot.findOne({ companyId: ctx.companyId, projectId: pid, _id: toObjectId(plotId) });
  if (!plot) throw notFound('Plot');
  const locked = !['available', 'blocked'].includes(plot.status);
  const touchesCommercials =
    PRICE_FIELDS.some((f) => input[f] !== undefined) || input.plotNumber !== undefined || input.blockId !== undefined;
  if (locked && touchesCommercials)
    throw businessRule('Area, rate, number and block cannot change while the plot is reserved, booked or sold');

  if (input.phaseId !== undefined || input.blockId !== undefined) {
    const h = await resolveHierarchy(
      ctx,
      pid,
      input.phaseId ?? (plot.phaseId ? String(plot.phaseId) : null),
      input.blockId ?? (plot.blockId ? String(plot.blockId) : null),
    );
    plot.phaseId = h.phaseId;
    plot.blockId = h.blockId;
  }
  const { phaseId: _p, blockId: _b, ...rest } = input;
  plot.set(rest);
  plot.listPricePaise = computeListPrice(plot.areaX100, plot.ratePaisePerSqft, plot.plcBp);
  await plot.save();
  await audit(ctx, { action: 'inventory.update', entityType: 'plot', entityId: plot._id, changes: input });
  return plot.toJSON();
}

/** Manual status changes (block/unblock, mark sold). Booking-driven changes go through the bookings service. */
export async function changePlotStatus(ctx: TenantContext, projectId: string, plotId: string, to: PlotStatus, reason: string) {
  await requireProject(ctx, projectId);
  const pid = toObjectId(projectId);
  return withTransaction(async (session) => {
    const plot = await Plot.findOne({ companyId: ctx.companyId, projectId: pid, _id: toObjectId(plotId) })
      .session(session)
      .lean();
    if (!plot) throw notFound('Plot');
    if (!MANUAL_PLOT_TRANSITIONS[plot.status].includes(to)) {
      throw businessRule(`Cannot change a ${plot.status} plot to ${to} manually`);
    }
    if (to === 'sold') {
      const booking = await Booking.findOne({ companyId: ctx.companyId, _id: plot.currentBookingId }).session(session).lean();
      if (!booking || booking.status !== 'booked') throw businessRule('Only plots with a confirmed booking can be marked sold');
      if (booking.allocatedPaise < booking.netAmountPaise)
        throw businessRule('The booking must be fully paid before the plot is marked sold');
    }
    // Conditional update: fails if someone else changed the status meanwhile.
    const res = await Plot.updateOne(
      { companyId: ctx.companyId, _id: plot._id, status: plot.status },
      { $set: { status: to } },
      { session },
    );
    if (res.modifiedCount !== 1) throw businessRule('Plot status changed concurrently, please retry');
    await recordPlotStatus(
      ctx,
      { projectId: pid, plotId: plot._id, from: plot.status, to, reason, bookingId: plot.currentBookingId ?? undefined },
      session,
    );
    await audit(
      ctx,
      { action: 'inventory.status_change', entityType: 'plot', entityId: plot._id, changes: { from: plot.status, to, reason } },
      session,
    );
    return { id: String(plot._id), status: to };
  });
}

export async function deletePlot(ctx: TenantContext, projectId: string, plotId: string) {
  await requireProject(ctx, projectId);
  const pid = toObjectId(projectId);
  const id = toObjectId(plotId);
  if (await BookingItem.exists({ companyId: ctx.companyId, plotId: id })) {
    throw businessRule('Plots that have ever been booked cannot be deleted; block them instead');
  }
  const res = await Plot.deleteOne({ companyId: ctx.companyId, projectId: pid, _id: id, status: { $in: ['available', 'blocked'] } });
  if (!res.deletedCount) throw notFound('Plot');
  await audit(ctx, { action: 'inventory.delete', entityType: 'plot', entityId: id });
}

export async function getMapData(ctx: TenantContext, projectId: string) {
  const project = await requireProject(ctx, projectId);
  const plots = await Plot.find({ companyId: ctx.companyId, projectId: toObjectId(projectId), deletedAt: null })
    .select('plotNumber status mapShape areaX100 listPricePaise facing category unitType blockId isCorner')
    .lean();
  const summary: Record<string, number> = {};
  for (const p of plots) summary[p.status] = (summary[p.status] ?? 0) + 1;
  return {
    map: project.map,
    summary,
    plots: plots.map((p) => ({
      id: String(p._id),
      plotNumber: p.plotNumber,
      status: p.status,
      points: p.mapShape?.points ?? null,
      areaX100: p.areaX100,
      listPricePaise: p.listPricePaise,
      facing: p.facing,
      category: p.category,
      isCorner: p.isCorner,
      blockId: p.blockId ? String(p.blockId) : null,
    })),
  };
}

export async function saveMapShapes(ctx: TenantContext, projectId: string, shapes: { plotId: string; points: string | null }[]) {
  await requireProject(ctx, projectId);
  const pid = toObjectId(projectId);
  const res = await Plot.bulkWrite(
    shapes.map((s) => ({
      updateOne: {
        filter: { companyId: ctx.companyId, projectId: pid, _id: toObjectId(s.plotId) },
        update: s.points ? { $set: { 'mapShape.points': s.points } } : { $unset: { mapShape: 1 } },
      },
    })),
  );
  await audit(ctx, { action: 'map.edit', entityType: 'project', entityId: pid, summary: `${res.matchedCount} plot shapes saved` });
  return { matched: res.matchedCount, modified: res.modifiedCount };
}
