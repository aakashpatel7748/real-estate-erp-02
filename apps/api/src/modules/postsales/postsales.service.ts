import type { Response } from 'express';
import PDFDocument from 'pdfkit';
import { Types, type ClientSession } from 'mongoose';
import {
  addDays,
  areaToSqft,
  formatDate,
  formatINR,
  parseISODate,
  SALES_DOC_SERIES,
  SALES_DOC_STATUSES,
  toISODate,
  todayInIndia,
  type BookingLoanInput,
  type FollowUpInput,
  type SalesDocCreateInput,
  type SalesDocKind,
} from '@erp/shared';
import { withTransaction } from '../../db/transaction';
import { audit } from '../../utils/audit';
import { badRequest, businessRule, notFound } from '../../utils/errors';
import { escapeRegex, pageMeta, parseSort } from '../../utils/http';
import { assertProjectAccess, scopedFilter, toObjectId, type TenantContext } from '../../utils/tenant';
import { Account } from '../accounting/accounting.models';
import { nextDocumentNumber } from '../accounting/ledger.service';
import { Booking, BookingItem, Installment } from '../bookings/booking.models';
import { Company } from '../companies/company.model';
import { Financer, Consultant } from '../masters/masters.models';
import { Plot } from '../plots/plot.models';
import { recordPlotStatus } from '../plots/plots.service';
import { CollectionFollowUp, SalesDocument } from './postsales.models';

const day = (d?: string) => parseISODate(d ?? todayInIndia());
const iso = (d?: Date | null) => (d ? toISODate(d) : '');

async function loadBooking(ctx: TenantContext, id: string | Types.ObjectId, session?: ClientSession) {
  const booking = await Booking.findOne({ companyId: ctx.companyId, _id: toObjectId(id) })
    .session(session ?? null)
    .lean();
  if (!booking) throw notFound('Booking');
  assertProjectAccess(ctx, booking.projectId);
  return booking;
}

/** What the customer still owes on open installments (optionally only those due by a date). */
async function outstanding(ctx: TenantContext, bookingId: Types.ObjectId, dueBy?: Date, session?: ClientSession) {
  const filter: Record<string, unknown> = { companyId: ctx.companyId, bookingId, status: { $in: ['pending', 'partial'] } };
  if (dueBy) filter.dueDate = { $lte: dueBy };
  const rows = await Installment.find(filter)
    .sort({ dueDate: 1, sequence: 1 })
    .session(session ?? null)
    .lean();
  return { rows, totalPaise: rows.reduce((s, r) => s + r.amountPaise - r.paidPaise, 0) };
}

// =====================================================================
// Home loans, allotment letters, cancellations
// =====================================================================

export async function setBookingLoan(ctx: TenantContext, bookingId: string, input: BookingLoanInput | null) {
  const booking = await loadBooking(ctx, bookingId);
  if (!['reserved', 'booked'].includes(booking.status)) throw businessRule(`This booking is ${booking.status}`);
  if (input) {
    if (!(await Financer.exists({ companyId: ctx.companyId, deletedAt: null, _id: toObjectId(input.financerId) }))) throw badRequest('Lender not found');
    if (input.disbursedPaise && input.sanctionedPaise && input.disbursedPaise > input.sanctionedPaise) {
      throw badRequest('Disbursed amount cannot exceed the sanctioned amount');
    }
  }
  const loan = input
    ? { ...input, financerId: toObjectId(input.financerId), sanctionDate: input.sanctionDate ? day(input.sanctionDate) : undefined }
    : undefined;
  await Booking.updateOne({ companyId: ctx.companyId, _id: booking._id }, loan ? { $set: { loan } } : { $unset: { loan: 1 } });
  await audit(ctx, { action: 'bookings.loan', entityType: 'booking', entityId: booking._id, changes: { loan: input } });
  return { id: String(booking._id), loan: loan ?? null };
}

export async function markAllotmentIssued(ctx: TenantContext, bookingId: string, issued: boolean, via?: string) {
  const booking = await loadBooking(ctx, bookingId);
  if (booking.status !== 'booked') throw businessRule('Allotment letters are issued for confirmed bookings');
  const update = issued
    ? { $set: { allotment: { issuedAt: new Date(), issuedBy: ctx.userId, deliveredVia: via } } }
    : { $unset: { allotment: 1 } };
  await Booking.updateOne({ companyId: ctx.companyId, _id: booking._id }, update);
  await audit(ctx, { action: issued ? 'postsales.allotment_issued' : 'postsales.allotment_unissued', entityType: 'booking', entityId: booking._id });
  return { id: String(booking._id), issued };
}

async function unitsByBooking(ctx: TenantContext, bookingIds: Types.ObjectId[], activeOnly = true) {
  const filter: Record<string, unknown> = { companyId: ctx.companyId, bookingId: { $in: bookingIds } };
  if (activeOnly) filter.active = true;
  const items = await BookingItem.find(filter).select('bookingId plotNumber blockCode').lean();
  const map = new Map<string, string[]>();
  for (const i of items) map.set(String(i.bookingId), [...(map.get(String(i.bookingId)) ?? []), i.blockCode ? `${i.blockCode}-${i.plotNumber}` : i.plotNumber]);
  return map;
}

const BOOKING_POP = (ctx: TenantContext) => [
  { path: 'customerId', select: 'name phone customerCode', match: { companyId: ctx.companyId } },
  { path: 'projectId', select: 'name code', match: { companyId: ctx.companyId } },
];

export async function listAllotments(ctx: TenantContext, q: { page: number; pageSize: number; sort?: string; q?: string; projectId?: string; issued?: string }) {
  const filter: Record<string, unknown> = { ...scopedFilter(ctx, q.projectId), status: 'booked' };
  if (q.issued === 'true') filter['allotment.issuedAt'] = { $ne: null };
  if (q.issued === 'false') filter['allotment.issuedAt'] = null;
  if (q.q) filter.bookingNumber = new RegExp(escapeRegex(q.q), 'i');
  const sort = parseSort(q.sort, ['bookingDate', 'bookingNumber', 'netAmountPaise'], { bookingDate: -1 });
  const [items, total, counts] = await Promise.all([
    Booking.find(filter)
      .sort(sort)
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .select('bookingNumber bookingDate netAmountPaise receivedPaise allotment customerId projectId status')
      .populate(BOOKING_POP(ctx))
      .populate('allotment.issuedBy', 'name')
      .lean(),
    Booking.countDocuments(filter),
    Booking.aggregate<{ issued: number; pending: number }>([
      { $match: { ...scopedFilter(ctx, q.projectId), status: 'booked' } },
      { $group: { _id: null, issued: { $sum: { $cond: [{ $ifNull: ['$allotment.issuedAt', false] }, 1, 0] } }, pending: { $sum: { $cond: [{ $ifNull: ['$allotment.issuedAt', false] }, 0, 1] } } } },
    ]),
  ]);
  const units = await unitsByBooking(ctx, items.map((i) => i._id));
  return {
    items: items.map((i) => ({ ...i, units: units.get(String(i._id)) ?? [] })),
    meta: pageMeta(q.page, q.pageSize, total),
    summary: { issued: counts[0]?.issued ?? 0, pending: counts[0]?.pending ?? 0 },
  };
}

export async function listCancellations(ctx: TenantContext, q: { page: number; pageSize: number; sort?: string; q?: string; projectId?: string; refund?: string }) {
  const filter: Record<string, unknown> = { ...scopedFilter(ctx, q.projectId), status: { $in: ['cancelled', 'expired'] } };
  if (q.refund === 'pending') filter.$expr = { $gt: ['$refundablePaise', '$refundedPaise'] };
  if (q.refund === 'settled') filter.$expr = { $lte: ['$refundablePaise', '$refundedPaise'] };
  if (q.q) filter.bookingNumber = new RegExp(escapeRegex(q.q), 'i');
  const sort = parseSort(q.sort, ['closedAt', 'bookingNumber', 'refundablePaise'], { closedAt: -1 });
  const [items, total, totals] = await Promise.all([
    Booking.find(filter)
      .sort(sort)
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .select('bookingNumber bookingDate status closedAt cancellation netAmountPaise receivedPaise refundablePaise refundedPaise customerId projectId')
      .populate(BOOKING_POP(ctx))
      .populate('cancellation.by', 'name')
      .lean(),
    Booking.countDocuments(filter),
    Booking.aggregate<{ n: number; charges: number; refundable: number; refunded: number }>([
      { $match: { ...scopedFilter(ctx, q.projectId), status: { $in: ['cancelled', 'expired'] } } },
      {
        $group: {
          _id: null,
          n: { $sum: 1 },
          charges: { $sum: { $ifNull: ['$cancellation.chargePaise', 0] } },
          refundable: { $sum: '$refundablePaise' },
          refunded: { $sum: '$refundedPaise' },
        },
      },
    ]),
  ]);
  const units = await unitsByBooking(
    ctx,
    items.map((i) => i._id),
    false,
  );
  const t = totals[0];
  return {
    items: items.map((i) => ({ ...i, units: units.get(String(i._id)) ?? [] })),
    meta: pageMeta(q.page, q.pageSize, total),
    summary: { count: t?.n ?? 0, chargesPaise: t?.charges ?? 0, refundablePaise: t?.refundable ?? 0, refundedPaise: t?.refunded ?? 0, pendingRefundPaise: (t?.refundable ?? 0) - (t?.refunded ?? 0) },
  };
}

// =====================================================================
// Dues & collection follow-ups
// =====================================================================

const BUCKETS: Record<string, [number, number]> = { '0_30': [1, 30], '31_60': [31, 60], '61_90': [61, 90], '90_plus': [91, 1e9] };

export async function listDues(
  ctx: TenantContext,
  q: { page: number; pageSize: number; sort?: string; q?: string; projectId?: string; bucket: string; followUp?: string },
) {
  const today = day();
  const in30 = new Date(today.getTime() + 30 * 86_400_000);
  const base = { ...scopedFilter(ctx, q.projectId), status: { $in: ['pending', 'partial'] } };
  const post: Record<string, unknown>[] = [];
  if (q.bucket === 'upcoming') post.push({ overduePaise: 0, upcomingPaise: { $gt: 0 } });
  else if (BUCKETS[q.bucket]) post.push({ daysOverdue: { $gte: BUCKETS[q.bucket]![0], $lte: BUCKETS[q.bucket]![1] } });
  if (q.followUp === 'due') post.push({ 'lastFollowUp.nextFollowUpOn': { $lte: today } });
  if (q.followUp === 'none') post.push({ lastFollowUp: null });
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    post.push({ $or: [{ 'customer.name': rx }, { 'customer.phone': rx }, { 'booking.bookingNumber': rx }] });
  }
  const sortField = (q.sort ?? '-overduePaise').replace(/^-/, '');
  const allowed = ['overduePaise', 'outstandingPaise', 'daysOverdue', 'upcomingPaise'];
  const sort = { [allowed.includes(sortField) ? sortField : 'overduePaise']: q.sort?.startsWith('-') === false ? 1 : -1, _id: 1 } as Record<string, 1 | -1>;

  const pipeline = [
    { $match: base },
    { $addFields: { balance: { $subtract: ['$amountPaise', '$paidPaise'] } } },
    {
      $group: {
        _id: '$bookingId',
        customerId: { $first: '$customerId' },
        projectId: { $first: '$projectId' },
        outstandingPaise: { $sum: '$balance' },
        overduePaise: { $sum: { $cond: [{ $lt: ['$dueDate', today] }, '$balance', 0] } },
        upcomingPaise: { $sum: { $cond: [{ $and: [{ $gte: ['$dueDate', today] }, { $lte: ['$dueDate', in30] }] }, '$balance', 0] } },
        oldestOverdue: { $min: { $cond: [{ $lt: ['$dueDate', today] }, '$dueDate', null] } },
        nextDue: { $min: { $cond: [{ $gte: ['$dueDate', today] }, '$dueDate', null] } },
      },
    },
    { $match: { outstandingPaise: { $gt: 0 } } },
    {
      $addFields: {
        daysOverdue: { $cond: [{ $ifNull: ['$oldestOverdue', false] }, { $floor: { $divide: [{ $subtract: [today, '$oldestOverdue'] }, 86_400_000] } }, 0] },
      },
    },
    {
      $lookup: {
        from: 'collectionfollowups',
        let: { b: '$_id' },
        pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$bookingId', '$$b'] }, { $eq: ['$companyId', ctx.companyId] }] } } }, { $sort: { createdAt: -1 } }, { $limit: 1 }],
        as: 'lastFollowUp',
      },
    },
    { $addFields: { lastFollowUp: { $ifNull: [{ $first: '$lastFollowUp' }, null] } } },
    {
      $lookup: {
        from: 'customers',
        let: { c: '$customerId' },
        pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$_id', '$$c'] }, { $eq: ['$companyId', ctx.companyId] }] } } }, { $project: { name: 1, phone: 1, customerCode: 1 } }],
        as: 'customer',
      },
    },
    {
      $lookup: {
        from: 'bookings',
        let: { b: '$_id' },
        pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$_id', '$$b'] }, { $eq: ['$companyId', ctx.companyId] }] } } }, { $project: { bookingNumber: 1, status: 1, netAmountPaise: 1, receivedPaise: 1 } }],
        as: 'booking',
      },
    },
    { $addFields: { customer: { $first: '$customer' }, booking: { $first: '$booking' } } },
    { $match: { 'booking.status': { $in: ['reserved', 'booked'] } } },
    ...(post.length ? [{ $match: { $and: post } }] : []),
    {
      $facet: {
        items: [{ $sort: sort }, { $skip: (q.page - 1) * q.pageSize }, { $limit: q.pageSize }],
        total: [{ $count: 'n' }],
        totals: [{ $group: { _id: null, overdue: { $sum: '$overduePaise' }, outstanding: { $sum: '$outstandingPaise' }, upcoming: { $sum: '$upcomingPaise' } } }],
      },
    },
  ];
  const [res] = await Installment.aggregate<{
    items: Record<string, unknown>[];
    total: { n: number }[];
    totals: { overdue: number; outstanding: number; upcoming: number }[];
  }>(pipeline as never[]);

  // Aging across the whole (unfiltered) portfolio for the bucket chips.
  const aging = await Installment.aggregate<{ _id: string; amount: number; bookings: number }>([
    { $match: { ...base, dueDate: { $lt: today } } },
    { $group: { _id: '$bookingId', oldest: { $min: '$dueDate' }, amount: { $sum: { $subtract: ['$amountPaise', '$paidPaise'] } } } },
    { $match: { amount: { $gt: 0 } } },
    {
      $addFields: { days: { $floor: { $divide: [{ $subtract: [today, '$oldest'] }, 86_400_000] } } },
    },
    {
      $group: {
        _id: { $switch: { branches: [{ case: { $lte: ['$days', 30] }, then: '0_30' }, { case: { $lte: ['$days', 60] }, then: '31_60' }, { case: { $lte: ['$days', 90] }, then: '61_90' }], default: '90_plus' } },
        amount: { $sum: '$amount' },
        bookings: { $sum: 1 },
      },
    },
  ]);
  const t = res?.totals[0];
  return {
    items: (res?.items ?? []).map((r) => ({ ...r, bookingId: r._id, id: String(r._id) })),
    meta: pageMeta(q.page, q.pageSize, res?.total[0]?.n ?? 0),
    summary: {
      overduePaise: t?.overdue ?? 0,
      outstandingPaise: t?.outstanding ?? 0,
      upcomingPaise: t?.upcoming ?? 0,
      aging: Object.fromEntries(aging.map((a) => [a._id, { amountPaise: a.amount, bookings: a.bookings }])),
    },
  };
}

export async function listFollowUps(ctx: TenantContext, bookingId: string) {
  const booking = await loadBooking(ctx, bookingId);
  return CollectionFollowUp.find({ companyId: ctx.companyId, bookingId: booking._id }).sort({ createdAt: -1 }).limit(100).populate('createdBy', 'name').lean();
}

export async function createFollowUp(ctx: TenantContext, input: FollowUpInput) {
  const booking = await loadBooking(ctx, input.bookingId);
  const f = await CollectionFollowUp.create({
    companyId: ctx.companyId,
    projectId: booking.projectId,
    bookingId: booking._id,
    customerId: booking.customerId,
    type: input.type,
    note: input.note,
    promisedAmountPaise: input.promisedAmountPaise,
    promisedOn: input.promisedOn ? day(input.promisedOn) : undefined,
    nextFollowUpOn: input.nextFollowUpOn ? day(input.nextFollowUpOn) : undefined,
    createdBy: ctx.userId,
  });
  return f.toJSON();
}

// =====================================================================
// Agreements, registries, possession and demand letters
// =====================================================================

async function companySettings(ctx: TenantContext) {
  const c = await Company.findById(ctx.companyId).select('settings').lean();
  return c?.settings;
}

async function duesGuard(
  ctx: TenantContext,
  kind: 'registry' | 'possession',
  bookingId: Types.ObjectId,
  override: boolean,
  remarks: string | undefined,
  session: ClientSession,
) {
  const settings = await companySettings(ctx);
  const required = kind === 'registry' ? (settings?.registryRequiresFullPayment ?? true) : (settings?.possessionRequiresFullPayment ?? true);
  const { totalPaise } = await outstanding(ctx, bookingId, undefined, session);
  if (required && totalPaise > 0) {
    if (!override) throw businessRule(`${formatINR(totalPaise)} is still outstanding on this booking. Collect it first, or proceed with an override and a remark.`);
    if (!remarks?.trim()) throw businessRule('Add a remark explaining why you are proceeding with dues outstanding');
  }
  return { outstandingPaise: totalPaise, overridden: required && totalPaise > 0 };
}

async function markUnitsSold(ctx: TenantContext, booking: { _id: Types.ObjectId; projectId: Types.ObjectId; bookingNumber: string }, session: ClientSession) {
  const items = await BookingItem.find({ companyId: ctx.companyId, bookingId: booking._id, active: true }).session(session).lean();
  for (const item of items) {
    const res = await Plot.updateOne(
      { companyId: ctx.companyId, _id: item.plotId, currentBookingId: booking._id, status: 'booked' },
      { $set: { status: 'sold' } },
      { session },
    );
    if (res.modifiedCount === 1) {
      await recordPlotStatus(ctx, { projectId: booking.projectId, plotId: item.plotId, from: 'booked', to: 'sold', reason: `Sale deed registered (${booking.bookingNumber})`, bookingId: booking._id }, session);
    }
  }
}

function cleanDetails(details: Record<string, unknown> = {}) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) if (v !== undefined && v !== '') out[k] = v;
  return out;
}

export async function createSalesDocument(ctx: TenantContext, input: SalesDocCreateInput) {
  return withTransaction(async (session) => {
    const booking = await loadBooking(ctx, input.bookingId, session);
    if (input.kind !== 'demand' && booking.status !== 'booked') throw businessRule('Confirm the booking first');
    if (input.kind === 'demand' && !['reserved', 'booked'].includes(booking.status)) throw businessRule(`This booking is ${booking.status}`);
    if (input.kind !== 'demand') {
      const active = await SalesDocument.exists({ companyId: ctx.companyId, bookingId: booking._id, kind: input.kind, status: { $ne: 'cancelled' } }).session(session);
      if (active) throw businessRule(`This booking already has an active ${input.kind === 'agreement' ? 'agreement' : input.kind === 'registry' ? 'registry' : 'possession letter'}`);
    }

    let status = SALES_DOC_STATUSES[input.kind][0]!;
    let details: Record<string, unknown> = {};
    let amountPaise = 0;
    let guard: { outstandingPaise: number; overridden: boolean } | undefined;

    if (input.kind === 'agreement') {
      details = cleanDetails(input.details);
      if (input.details.executedOn) status = 'executed';
      if (input.details.registrationNumber && input.details.executedOn) status = 'registered';
      amountPaise = (input.details.stampDutyPaise ?? 0) + (input.details.registrationFeePaise ?? 0);
    } else if (input.kind === 'registry') {
      if (input.details.consultantId && !(await Consultant.exists({ companyId: ctx.companyId, _id: toObjectId(input.details.consultantId) }).session(session))) {
        throw badRequest('Consultant not found');
      }
      guard = await duesGuard(ctx, 'registry', booking._id, input.overrideDues, input.remarks, session);
      details = cleanDetails({ ...input.details, consultantId: input.details.consultantId ? toObjectId(input.details.consultantId) : undefined });
      amountPaise = (input.details.stampDutyPaise ?? 0) + (input.details.registrationFeePaise ?? 0);
      if (input.details.registeredOn) {
        if (!input.details.deedNumber) throw badRequest('Enter the deed number of the registered sale deed');
        status = 'registered';
      }
    } else if (input.kind === 'possession') {
      guard = await duesGuard(ctx, 'possession', booking._id, input.overrideDues, input.remarks, session);
      details = cleanDetails(input.details);
      if (input.details.handedOverOn) status = 'handed_over';
    } else {
      const settings = await companySettings(ctx);
      const dueUpTo = input.dueUpTo ?? addDays(input.date, settings?.demandLeadDays ?? 15);
      const due = await outstanding(ctx, booking._id, day(dueUpTo), session);
      if (due.totalPaise <= 0) throw businessRule('Nothing falls due on this booking by that date');
      details = {
        dueUpTo,
        payBy: input.payBy ?? addDays(input.date, 7),
        lines: due.rows.map((r) => ({
          installmentId: r._id,
          name: r.name,
          dueDate: iso(r.dueDate),
          amountPaise: r.amountPaise,
          paidPaise: r.paidPaise,
          balancePaise: r.amountPaise - r.paidPaise,
        })),
        lateInterestBpPerMonth: settings?.lateInterestBpPerMonth ?? 0,
      };
      amountPaise = due.totalPaise;
    }

    const number = await nextDocumentNumber(ctx.companyId, SALES_DOC_SERIES[input.kind], input.date, session);
    const [doc] = await SalesDocument.create(
      [
        {
          companyId: ctx.companyId,
          kind: input.kind,
          number,
          projectId: booking.projectId,
          bookingId: booking._id,
          customerId: booking.customerId,
          date: day(input.date),
          status,
          details,
          amountPaise,
          outstandingAtCreationPaise: guard?.outstandingPaise,
          duesOverridden: guard?.overridden,
          remarks: input.remarks,
          history: [{ status, note: input.remarks, by: ctx.userId }],
          createdBy: ctx.userId,
        },
      ],
      { session },
    );
    if (input.kind === 'registry' && status === 'registered') await markUnitsSold(ctx, booking, session);
    await audit(ctx, { action: `postsales.${input.kind}_create`, entityType: 'booking', entityId: booking._id, summary: `${number} (${status})` }, session);
    return doc!.toJSON();
  });
}

const NEXT_STATUS: Record<SalesDocKind, Record<string, string[]>> = {
  agreement: { draft: ['executed', 'cancelled'], executed: ['registered', 'cancelled'], registered: ['cancelled'] },
  registry: { scheduled: ['registered', 'cancelled'] },
  possession: { offered: ['handed_over', 'cancelled'] },
  demand: { issued: ['cancelled'] },
};

export async function updateSalesDocument(
  ctx: TenantContext,
  id: string,
  input: { status?: string; details?: Record<string, unknown>; remarks?: string; overrideDues: boolean },
) {
  return withTransaction(async (session) => {
    const doc = await SalesDocument.findOne({ companyId: ctx.companyId, _id: toObjectId(id) }).session(session).lean();
    if (!doc) throw notFound('Document');
    assertProjectAccess(ctx, doc.projectId);
    const kind = doc.kind as SalesDocKind;
    if (doc.status === 'cancelled') throw businessRule('This document has been cancelled');
    const set: Record<string, unknown> = {};
    if (input.details) {
      if (kind === 'demand') throw businessRule('Demand letters cannot be edited; cancel and issue a new one');
      // Only known detail keys for the kind are kept (validated against the create schema shape).
      const allowed: Record<string, string[]> = {
        agreement: ['executedOn', 'stampDutyPaise', 'registrationFeePaise', 'registrationNumber', 'witnesses', 'terms'],
        registry: ['scheduledOn', 'registeredOn', 'deedNumber', 'subRegistrarOffice', 'stampDutyPaise', 'registrationFeePaise', 'consultantId'],
        possession: ['offeredOn', 'handedOverOn', 'possessionType', 'keysHandedTo'],
      };
      const merged: Record<string, unknown> = { ...(doc.details as object) };
      for (const [k, v] of Object.entries(input.details)) {
        if (!allowed[kind]!.includes(k)) throw badRequest(`Unknown field ${k}`);
        if (k.endsWith('Paise') && v !== null && v !== undefined && (!Number.isSafeInteger(v) || (v as number) < 0)) throw badRequest(`${k} must be whole paise`);
        if (k.endsWith('On') && v && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw badRequest(`${k} must be a date`);
        if (k === 'consultantId' && v && !(await Consultant.exists({ companyId: ctx.companyId, _id: toObjectId(String(v)) }).session(session))) throw badRequest('Consultant not found');
        if (v === null || v === '') delete merged[k];
        else merged[k] = typeof v === 'string' ? v.slice(0, 10_000) : v;
      }
      set.details = merged;
      set.amountPaise = Number(merged.stampDutyPaise ?? 0) + Number(merged.registrationFeePaise ?? 0);
    }
    if (input.remarks !== undefined) set.remarks = input.remarks;
    const details = (set.details ?? doc.details) as Record<string, unknown>;
    let to: string | undefined;
    if (input.status && input.status !== doc.status) {
      to = input.status;
      if (!NEXT_STATUS[kind][doc.status]?.includes(to)) throw businessRule(`A ${doc.status.replace('_', ' ')} ${kind} cannot be marked ${to.replace('_', ' ')}`);
      if (kind === 'registry' && to === 'registered') {
        if (!details.deedNumber || !details.registeredOn) throw badRequest('Enter the deed number and registration date first');
        await duesGuard(ctx, 'registry', doc.bookingId, input.overrideDues || !!doc.duesOverridden, input.remarks ?? doc.remarks ?? undefined, session);
      }
      if (kind === 'possession' && to === 'handed_over') {
        if (!details.handedOverOn) details.handedOverOn = todayInIndia();
        set.details = details;
        await duesGuard(ctx, 'possession', doc.bookingId, input.overrideDues || !!doc.duesOverridden, input.remarks ?? doc.remarks ?? undefined, session);
      }
      if (kind === 'agreement' && to === 'executed' && !details.executedOn) {
        details.executedOn = todayInIndia();
        set.details = details;
      }
      set.status = to;
    }
    const res = await SalesDocument.updateOne(
      { companyId: ctx.companyId, _id: doc._id, status: doc.status },
      { $set: set, ...(to ? { $push: { history: { status: to, note: input.remarks, by: ctx.userId } } } : {}) },
      { session },
    );
    if (res.modifiedCount !== 1 && Object.keys(set).length) throw businessRule('The document changed concurrently, please retry');
    if (kind === 'registry' && to === 'registered') {
      const booking = await loadBooking(ctx, doc.bookingId, session);
      await markUnitsSold(ctx, booking, session);
    }
    await audit(ctx, { action: `postsales.${kind}_update`, entityType: 'booking', entityId: doc.bookingId, summary: doc.number, changes: { ...input, details: undefined } }, session);
    return { id: String(doc._id), status: to ?? doc.status };
  });
}

/** Issues demand letters for every active booking in a project with dues by the cut-off date. */
export async function bulkDemand(ctx: TenantContext, input: { projectId: string; date: string; dueUpTo?: string; payBy?: string }) {
  assertProjectAccess(ctx, input.projectId);
  const settings = await companySettings(ctx);
  const dueUpTo = input.dueUpTo ?? addDays(input.date, settings?.demandLeadDays ?? 15);
  const candidates = await Installment.aggregate<{ _id: Types.ObjectId }>([
    { $match: { companyId: ctx.companyId, projectId: toObjectId(input.projectId), status: { $in: ['pending', 'partial'] }, dueDate: { $lte: day(dueUpTo) } } },
    { $group: { _id: '$bookingId', bal: { $sum: { $subtract: ['$amountPaise', '$paidPaise'] } } } },
    { $match: { bal: { $gt: 0 } } },
  ]);
  const already = new Set(
    (await SalesDocument.find({ companyId: ctx.companyId, kind: 'demand', status: 'issued', date: day(input.date), bookingId: { $in: candidates.map((c) => c._id) } }).select('bookingId').lean()).map(
      (d) => String(d.bookingId),
    ),
  );
  let created = 0;
  let skipped = 0;
  for (const c of candidates) {
    if (already.has(String(c._id))) {
      skipped++;
      continue;
    }
    try {
      await createSalesDocument(ctx, { kind: 'demand', bookingId: String(c._id), date: input.date, dueUpTo, payBy: input.payBy });
      created++;
    } catch {
      skipped++;
    }
  }
  return { created, skipped };
}

export async function listSalesDocuments(
  ctx: TenantContext,
  q: { page: number; pageSize: number; sort?: string; q?: string; kind: SalesDocKind; projectId?: string; status?: string; bookingId?: string },
) {
  const filter: Record<string, unknown> = { ...scopedFilter(ctx, q.projectId), kind: q.kind };
  if (q.status) filter.status = q.status;
  if (q.bookingId) filter.bookingId = toObjectId(q.bookingId);
  if (q.q) filter.number = new RegExp(escapeRegex(q.q), 'i');
  const sort = parseSort(q.sort, ['date', 'number', 'amountPaise', 'status'], { date: -1, createdAt: -1 });
  const [items, total, counts] = await Promise.all([
    SalesDocument.find(filter)
      .sort(sort)
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .select('-history')
      .populate({ path: 'bookingId', select: 'bookingNumber status', match: { companyId: ctx.companyId } })
      .populate({ path: 'customerId', select: 'name phone', match: { companyId: ctx.companyId } })
      .populate({ path: 'projectId', select: 'name code', match: { companyId: ctx.companyId } })
      .lean(),
    SalesDocument.countDocuments(filter),
    SalesDocument.aggregate<{ _id: string; n: number }>([{ $match: { ...scopedFilter(ctx, q.projectId), kind: q.kind } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);
  return { items, meta: pageMeta(q.page, q.pageSize, total), summary: Object.fromEntries(counts.map((c) => [c._id, c.n])) };
}

export async function getSalesDocument(ctx: TenantContext, id: string) {
  const doc = await SalesDocument.findOne({ ...scopedFilter(ctx), _id: toObjectId(id) })
    .populate({ path: 'bookingId', select: 'bookingNumber status bookingDate netAmountPaise receivedPaise', match: { companyId: ctx.companyId } })
    .populate({ path: 'customerId', select: 'name phone email address coApplicants pan', match: { companyId: ctx.companyId } })
    .populate({ path: 'projectId', select: 'name code reraNumber address', match: { companyId: ctx.companyId } })
    .populate('history.by', 'name')
    .lean();
  if (!doc) throw notFound('Document');
  const details = doc.details as Record<string, unknown>;
  const consultant = details?.consultantId ? await Consultant.findOne({ companyId: ctx.companyId, _id: details.consultantId }).select('name firm phone').lean() : null;
  const items = await BookingItem.find({ companyId: ctx.companyId, bookingId: (doc.bookingId as unknown as { _id: Types.ObjectId })?._id ?? doc.bookingId, active: true }).lean();
  return { ...doc, consultant, units: items };
}

// ---------------- PDFs ----------------

const rs = (paise: number) => `Rs. ${formatINR(paise, { symbol: false })}`;
const TITLES: Record<SalesDocKind, string> = {
  agreement: 'AGREEMENT FOR SALE (BUILDER-BUYER AGREEMENT)',
  registry: 'SALE DEED REGISTRATION MEMO',
  possession: 'POSSESSION LETTER',
  demand: 'PAYMENT DEMAND LETTER',
};
const DEFAULT_TERMS = [
  'The Allottee shall pay the total consideration as per the payment schedule annexed hereto. Delay in payment shall attract interest as per the applicable RERA rules.',
  'The Promoter shall hand over possession of the unit on or before the date committed, subject to force majeure and timely payment by the Allottee.',
  'Stamp duty, registration charges, GST and other statutory levies, as applicable, shall be borne by the Allottee.',
  'The Allottee shall not transfer or assign this agreement without the prior written consent of the Promoter.',
  'Cancellation by the Allottee shall be governed by the cancellation policy of the Promoter and applicable law.',
  'This agreement is subject to the jurisdiction of the courts where the project is situated.',
];

export async function salesDocumentPdf(ctx: TenantContext, id: string, res: Response) {
  const d = (await getSalesDocument(ctx, id)) as unknown as {
    kind: SalesDocKind;
    number: string;
    status: string;
    date: Date;
    amountPaise: number;
    remarks?: string;
    details: Record<string, unknown>;
    bookingId: { _id: Types.ObjectId; bookingNumber: string; bookingDate: Date; netAmountPaise: number; receivedPaise: number };
    customerId: { name: string; phone: string; email?: string; pan?: string; address?: { line1?: string; city?: string; state?: string }; coApplicants?: { name: string }[] };
    projectId: { name: string; reraNumber?: string; address?: { line1?: string; city?: string; state?: string } };
    consultant?: { name: string; firm?: string } | null;
    units: { plotNumber: string; blockCode?: string; areaX100: number; lineTotalPaise: number }[];
  };
  const company = await Company.findById(ctx.companyId).lean();
  const bank = await Account.findOne({ companyId: ctx.companyId, isActive: true, 'bankDetails.accountNumber': { $exists: true, $ne: null } })
    .sort({ 'bankDetails.isReraAccount': -1, code: 1 })
    .lean();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${d.number.replace(/[^\w.-]/g, '_')}.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(res);
  const companyName = company?.legalName || company?.name || '';
  doc.fontSize(16).font('Helvetica-Bold').text(companyName);
  doc.fontSize(9).font('Helvetica').fillColor('#555');
  const addr = [company?.address?.line1, company?.address?.city, company?.address?.state, company?.address?.pincode].filter(Boolean).join(', ');
  if (addr) doc.text(addr);
  if (company?.gstin) doc.text(`GSTIN: ${company.gstin}`);
  doc.moveDown(0.8).fillColor('#000').fontSize(13).font('Helvetica-Bold').text(TITLES[d.kind], { align: 'center' });
  if (d.status === 'cancelled') doc.fillColor('#b91c1c').fontSize(11).text('CANCELLED', { align: 'center' }).fillColor('#000');
  doc.moveDown(0.6).fontSize(10).font('Helvetica');
  const row = (label: string, value: string) => {
    const y = doc.y;
    doc.font('Helvetica-Bold').text(label, 50, y, { width: 170 });
    doc.font('Helvetica').text(value, 220, y, { width: 325 });
    doc.moveDown(0.3);
  };
  const units = d.units.map((u) => `${u.blockCode ? `${u.blockCode}-` : ''}${u.plotNumber} (${areaToSqft(u.areaX100)} sq ft)`).join(', ');
  const cust = d.customerId;
  const custAddr = [cust?.address?.line1, cust?.address?.city, cust?.address?.state].filter(Boolean).join(', ');
  row('Reference', d.number);
  row('Date', formatDate(iso(d.date)));
  row('Booking', d.bookingId?.bookingNumber ?? '');
  row(d.kind === 'agreement' ? 'Allottee' : 'Customer', `${cust?.name ?? ''}${cust?.coApplicants?.length ? ` & ${cust.coApplicants.map((c) => c.name).join(', ')}` : ''}`);
  if (custAddr) row('Address', custAddr);
  row('Project', `${d.projectId?.name ?? ''}${d.projectId?.reraNumber ? ` (RERA: ${d.projectId.reraNumber})` : ''}`);
  row('Unit(s)', units);
  const det = d.details ?? {};

  if (d.kind === 'agreement') {
    row('Total consideration', rs(d.bookingId?.netAmountPaise ?? 0));
    if (det.executedOn) row('Executed on', formatDate(String(det.executedOn)));
    if (det.registrationNumber) row('Registration No.', String(det.registrationNumber));
    if (det.stampDutyPaise) row('Stamp duty', rs(Number(det.stampDutyPaise)));
    if (det.registrationFeePaise) row('Registration fee', rs(Number(det.registrationFeePaise)));
    doc.moveDown(0.6).font('Helvetica-Bold').text('Parties').font('Helvetica');
    doc.text(`This Agreement is made between ${companyName} ("the Promoter") and ${cust?.name ?? ''} ("the Allottee") for the unit(s) described above in ${d.projectId?.name ?? ''}.`);
    doc.moveDown(0.6).font('Helvetica-Bold').text('Terms').font('Helvetica');
    const terms = typeof det.terms === 'string' && det.terms.trim() ? det.terms.split(/\n+/) : DEFAULT_TERMS;
    terms.forEach((t, i) => doc.text(`${i + 1}. ${t.trim()}`).moveDown(0.2));
    if (det.witnesses) doc.moveDown(0.4).text(`Witnesses: ${String(det.witnesses)}`);
    doc.moveDown(2.5);
    const y = doc.y;
    doc.text('For the Promoter', 50, y).text('Allottee', 400, y);
  } else if (d.kind === 'registry') {
    if (det.scheduledOn) row('Scheduled on', formatDate(String(det.scheduledOn)));
    if (det.registeredOn) row('Registered on', formatDate(String(det.registeredOn)));
    if (det.deedNumber) row('Deed number', String(det.deedNumber));
    if (det.subRegistrarOffice) row('Sub-registrar office', String(det.subRegistrarOffice));
    if (det.stampDutyPaise) row('Stamp duty', rs(Number(det.stampDutyPaise)));
    if (det.registrationFeePaise) row('Registration fee', rs(Number(det.registrationFeePaise)));
    if (d.consultant) row('Registry consultant', `${d.consultant.name}${d.consultant.firm ? `, ${d.consultant.firm}` : ''}`);
    row('Status', d.status.replace('_', ' ').toUpperCase());
    doc.moveDown(1).text(
      d.status === 'registered'
        ? `The sale deed for the above unit(s) has been registered in favour of ${cust?.name ?? ''}. Ownership stands transferred as per the registered deed.`
        : `The sale deed registration for the above unit(s) is scheduled as stated. The purchaser is requested to be present with original identity documents and two passport-size photographs.`,
    );
  } else if (d.kind === 'possession') {
    doc.moveDown(0.6).text(`Dear ${cust?.name ?? 'Customer'},`).moveDown(0.5);
    doc.text(
      d.status === 'handed_over'
        ? `We are pleased to confirm that ${det.possessionType === 'paper' ? 'paper' : 'physical'} possession of the above unit(s) was handed over to you on ${formatDate(String(det.handedOverOn ?? iso(d.date)))}${det.keysHandedTo ? ` (received by ${String(det.keysHandedTo)})` : ''}. From this date, maintenance and statutory charges for the unit(s) are payable by you.`
        : `We are pleased to offer you possession of the above unit(s)${det.offeredOn ? ` from ${formatDate(String(det.offeredOn))}` : ''}. Kindly contact our office to schedule the handover after clearing any outstanding dues and completing the documentation.`,
    );
    doc.moveDown(2).text(`For ${companyName}`).moveDown(2).text('Authorised Signatory');
  } else {
    const lines = (det.lines as { name: string; dueDate: string; amountPaise: number; paidPaise: number; balancePaise: number }[]) ?? [];
    doc.moveDown(0.4).text(`Dear ${cust?.name ?? 'Customer'},`).moveDown(0.3);
    doc.text(`The following installment(s) on your booking are due. Kindly pay ${rs(d.amountPaise)} on or before ${formatDate(String(det.payBy))}.`).moveDown(0.5);
    const top = doc.y;
    const cols = [50, 230, 320, 410, 480];
    doc.font('Helvetica-Bold');
    ['Installment', 'Due date', 'Amount', 'Paid', 'Balance'].forEach((h, i) => doc.text(h, cols[i]!, top, { width: i === 0 ? 175 : 85 }));
    doc.font('Helvetica');
    let y = top + 16;
    for (const l of lines) {
      doc.text(l.name, cols[0]!, y, { width: 175 });
      doc.text(formatDate(l.dueDate), cols[1]!, y);
      doc.text(formatINR(l.amountPaise, { symbol: false }), cols[2]!, y);
      doc.text(formatINR(l.paidPaise, { symbol: false }), cols[3]!, y);
      doc.text(formatINR(l.balancePaise, { symbol: false }), cols[4]!, y);
      y += 16;
    }
    doc.font('Helvetica-Bold').text(`Total due: ${rs(d.amountPaise)}`, 50, y + 6);
    doc.font('Helvetica').moveDown(0.8);
    if (Number(det.lateInterestBpPerMonth) > 0) {
      doc.text(`Delayed payments attract interest at ${(Number(det.lateInterestBpPerMonth) / 100).toFixed(2)}% per month as per the agreement.`, 50);
    }
    if (bank?.bankDetails?.accountNumber) {
      doc.moveDown(0.6).font('Helvetica-Bold').text('Payment details', 50).font('Helvetica');
      doc.text(`Account name: ${companyName}`);
      doc.text(`Bank: ${bank.bankDetails.bankName ?? ''}${bank.bankDetails.branch ? `, ${bank.bankDetails.branch}` : ''}`);
      doc.text(`A/c No.: ${bank.bankDetails.accountNumber}   IFSC: ${bank.bankDetails.ifsc ?? ''}`);
    }
    doc.moveDown(1.5).text('Please ignore this letter if the payment has already been made.').moveDown(1.5).text(`For ${companyName}`).moveDown(2).text('Authorised Signatory');
  }
  if (d.remarks && d.kind !== 'agreement') doc.moveDown(1).fontSize(9).fillColor('#555').text(`Remarks: ${d.remarks}`, 50);
  doc.end();
}

