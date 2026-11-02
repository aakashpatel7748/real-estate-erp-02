import { Types, type ClientSession } from 'mongoose';
import {
  applyBasisPoints,
  formatINR,
  parseISODate,
  todayInIndia,
  type CashBankAccountInput,
  type GstVoucherInput,
  type LedgerAdjustmentInput,
  type PdcInput,
  type SystemAccountKey,
} from '@erp/shared';
import { withTransaction } from '../../db/transaction';
import { audit } from '../../utils/audit';
import { badRequest, businessRule, conflict, notFound } from '../../utils/errors';
import { escapeRegex, pageMeta, parseSort } from '../../utils/http';
import { assertProjectAccess, scopedFilter, toObjectId, type TenantContext } from '../../utils/tenant';
import { Account, JournalEntry } from '../accounting/accounting.models';
import {
  CONTROL_ACCOUNT_KEYS,
  nextDocumentNumber,
  partyBalance,
  postJournal,
  resolveCashAccountFor,
  reverseJournal,
  systemAccountId,
} from '../accounting/ledger.service';
import { Booking, Installment } from '../bookings/booking.models';
import { Vendor, VendorPayment } from '../construction/construction.models';
import { recordPayment } from '../payments/payments.service';
import { GstVoucher, LedgerAdjustment, Pdc } from './finance.models';

const day = (d?: string) => parseISODate(d ?? todayInIndia());
const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

// =====================================================================
// Bank & cash accounts
// =====================================================================

function cashBankFilter(ctx: TenantContext) {
  return {
    companyId: ctx.companyId,
    type: 'asset',
    $or: [{ systemKey: { $in: ['cash', 'bank'] } }, { isBank: true }, { cashBankKind: { $in: ['bank', 'cash'] } }],
  };
}

export async function listCashBankAccounts(ctx: TenantContext) {
  const accounts = await Account.find(cashBankFilter(ctx)).sort({ code: 1 }).lean();
  const ids = accounts.map((a) => a._id);
  const balances = await JournalEntry.aggregate<{ _id: Types.ObjectId; debit: number; credit: number; last: Date }>([
    { $match: { companyId: ctx.companyId, 'lines.accountId': { $in: ids } } },
    { $unwind: '$lines' },
    { $match: { 'lines.accountId': { $in: ids } } },
    {
      $group: {
        _id: '$lines.accountId',
        debit: { $sum: '$lines.debitPaise' },
        credit: { $sum: '$lines.creditPaise' },
        last: { $max: '$date' },
      },
    },
  ]);
  const byId = new Map(balances.map((b) => [String(b._id), b]));
  return accounts.map((a) => {
    const b = byId.get(String(a._id));
    return {
      ...a,
      kind: a.cashBankKind ?? (a.systemKey === 'cash' ? 'cash' : 'bank'),
      balancePaise: (b?.debit ?? 0) - (b?.credit ?? 0),
      inflowPaise: b?.debit ?? 0,
      outflowPaise: b?.credit ?? 0,
      lastTransactionOn: b?.last,
    };
  });
}

async function nextCashBankCode(ctx: TenantContext, kind: 'bank' | 'cash') {
  const [lo, hi] = kind === 'cash' ? [1001, 1009] : [1011, 1099];
  const taken = new Set((await Account.find({ companyId: ctx.companyId }).select('code').lean()).map((a) => a.code));
  for (let c = lo; c <= hi; c++) if (!taken.has(String(c))) return String(c);
  for (let c = 1; c < 1000; c++) if (!taken.has(`${lo - 1}-${c}`)) return `${lo - 1}-${c}`;
  throw businessRule('No free account codes left in the cash/bank range');
}

export async function createCashBankAccount(ctx: TenantContext, input: CashBankAccountInput) {
  return withTransaction(async (session) => {
    const code = await nextCashBankCode(ctx, input.kind);
    const [account] = await Account.create(
      [
        {
          companyId: ctx.companyId,
          code,
          name: input.name,
          type: 'asset',
          isBank: input.kind === 'bank',
          cashBankKind: input.kind,
          bankDetails:
            input.kind === 'bank'
              ? {
                  bankName: input.bankName,
                  accountNumber: input.accountNumber,
                  ifsc: input.ifsc,
                  branch: input.branch,
                  accountType: input.accountType,
                  isReraAccount: input.isReraAccount,
                }
              : undefined,
        },
      ],
      { session },
    );
    if (input.openingBalancePaise > 0) {
      await postJournal(
        ctx,
        {
          date: input.openingDate ?? todayInIndia(),
          voucherType: 'journal',
          narration: `Opening balance: ${input.name}`,
          lines: [
            { accountId: account!._id, debitPaise: input.openingBalancePaise },
            { systemKey: 'capital', creditPaise: input.openingBalancePaise },
          ],
          source: { type: 'opening_balance', id: account!._id },
        },
        session,
      );
    }
    await audit(
      ctx,
      { action: 'accounting.cash_bank_create', entityType: 'account', entityId: account!._id, summary: `${code} ${input.name}` },
      session,
    );
    return account!.toJSON();
  });
}

export async function updateCashBankAccount(ctx: TenantContext, id: string, input: Partial<CashBankAccountInput> & { isActive?: boolean }) {
  const account = await Account.findOne({ ...cashBankFilter(ctx), _id: toObjectId(id) });
  if (!account) throw notFound('Account');
  if (input.isActive === false && account.systemKey) throw businessRule('The default cash and bank accounts cannot be deactivated');
  if (input.name) account.name = input.name;
  if (input.isActive !== undefined) account.isActive = input.isActive;
  const details = ['bankName', 'accountNumber', 'ifsc', 'branch', 'accountType', 'isReraAccount'] as const;
  for (const k of details) if (input[k] !== undefined) account.set(`bankDetails.${k}`, input[k]);
  await account.save();
  await audit(ctx, { action: 'accounting.cash_bank_update', entityType: 'account', entityId: account._id, changes: input });
  return account.toJSON();
}

// =====================================================================
// Post-dated cheques
// =====================================================================

const PENDING_PDC = ['received', 'deposited', 'clearing'];

async function activeBooking(ctx: TenantContext, bookingId: string | Types.ObjectId) {
  const booking = await Booking.findOne({ companyId: ctx.companyId, _id: toObjectId(bookingId) }).lean();
  if (!booking) throw notFound('Booking');
  assertProjectAccess(ctx, booking.projectId);
  if (!['reserved', 'booked'].includes(booking.status)) throw businessRule(`This booking is ${booking.status}`);
  return booking;
}

export async function listPdcs(
  ctx: TenantContext,
  q: {
    page: number;
    pageSize: number;
    sort?: string;
    q?: string;
    projectId?: string;
    status?: string;
    bookingId?: string;
    due?: string;
    from?: string;
    to?: string;
  },
) {
  const base = scopedFilter(ctx, q.projectId);
  const filter: Record<string, unknown> = { ...base };
  if (q.status) filter.status = q.status;
  if (q.bookingId) filter.bookingId = toObjectId(q.bookingId);
  if (q.due) {
    filter.status = 'received';
    filter.chequeDate = { $lte: day() };
  }
  if (q.from || q.to) filter.chequeDate = { ...(q.from ? { $gte: day(q.from) } : {}), ...(q.to ? { $lte: day(q.to) } : {}) };
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ chequeNumber: rx }, { bankName: rx }];
  }
  const sort = parseSort(q.sort, ['chequeDate', 'amountPaise', 'status', 'createdAt'], { chequeDate: 1 });
  const [items, total, summary] = await Promise.all([
    Pdc.find(filter)
      .sort(sort)
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .select('-history')
      .populate({ path: 'customerId', select: 'name phone', match: { companyId: ctx.companyId } })
      .populate({ path: 'bookingId', select: 'bookingNumber', match: { companyId: ctx.companyId } })
      .populate({ path: 'projectId', select: 'name code', match: { companyId: ctx.companyId } })
      .populate({ path: 'paymentId', select: 'number', match: { companyId: ctx.companyId } })
      .lean(),
    Pdc.countDocuments(filter),
    Pdc.aggregate<{ _id: string; n: number; amount: number }>([
      { $match: base },
      { $group: { _id: '$status', n: { $sum: 1 }, amount: { $sum: '$amountPaise' } } },
    ]),
  ]);
  const dueForDeposit = await Pdc.aggregate<{ n: number; amount: number }>([
    { $match: { ...base, status: 'received', chequeDate: { $lte: day() } } },
    { $group: { _id: null, n: { $sum: 1 }, amount: { $sum: '$amountPaise' } } },
  ]);
  return {
    items,
    meta: pageMeta(q.page, q.pageSize, total),
    summary: {
      byStatus: Object.fromEntries(summary.map((s) => [s._id, { count: s.n, amountPaise: s.amount }])),
      dueForDeposit: { count: dueForDeposit[0]?.n ?? 0, amountPaise: dueForDeposit[0]?.amount ?? 0 },
    },
  };
}

export async function createPdc(ctx: TenantContext, input: PdcInput) {
  const booking = await activeBooking(ctx, input.bookingId);
  const pending = await Pdc.aggregate<{ amount: number }>([
    { $match: { companyId: ctx.companyId, bookingId: booking._id, status: { $in: PENDING_PDC } } },
    { $group: { _id: null, amount: { $sum: '$amountPaise' } } },
  ]);
  const outstanding = booking.netAmountPaise - booking.allocatedPaise;
  const pendingAmount = pending[0]?.amount ?? 0;
  if (pendingAmount + input.amountPaise > outstanding) {
    throw businessRule(
      `Cheques on hand (${formatINR(pendingAmount)}) plus this cheque would exceed the ${formatINR(outstanding)} outstanding on ${booking.bookingNumber}`,
    );
  }
  try {
    const pdc = await Pdc.create({
      ...input,
      companyId: ctx.companyId,
      projectId: booking.projectId,
      bookingId: booking._id,
      customerId: booking.customerId,
      chequeDate: day(input.chequeDate),
      status: 'received',
      history: [{ status: 'received', by: ctx.userId }],
      createdBy: ctx.userId,
    });
    await audit(ctx, {
      action: 'pdc.create',
      entityType: 'pdc',
      entityId: pdc._id,
      summary: `Chq ${input.chequeNumber} ${formatINR(input.amountPaise)} for ${booking.bookingNumber}`,
    });
    return pdc.toJSON();
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw conflict('This cheque is already recorded for the booking');
    throw err;
  }
}

async function loadPdc(ctx: TenantContext, id: string) {
  const pdc = await Pdc.findOne({ companyId: ctx.companyId, _id: toObjectId(id) }).lean();
  if (!pdc) throw notFound('Cheque');
  assertProjectAccess(ctx, pdc.projectId);
  return pdc;
}

async function movePdc(ctx: TenantContext, id: Types.ObjectId, from: string[], to: string, set: Record<string, unknown>, note?: string) {
  const res = await Pdc.updateOne(
    { companyId: ctx.companyId, _id: id, status: { $in: from } },
    { $set: { status: to, ...set }, $push: { history: { status: to, note, by: ctx.userId } } },
  );
  if (res.modifiedCount !== 1) throw businessRule(`Only ${from.join(' or ')} cheques can be marked ${to}`);
}

export async function depositPdc(ctx: TenantContext, id: string, input: { depositedOn: string; depositAccountId?: string }) {
  const pdc = await loadPdc(ctx, id);
  const accountId = await withTransaction((session) => resolveCashAccountFor(ctx.companyId, input.depositAccountId, 'cheque', session));
  await movePdc(ctx, pdc._id, ['received'], 'deposited', { depositedOn: day(input.depositedOn), depositAccountId: accountId });
  await audit(ctx, { action: 'pdc.deposit', entityType: 'pdc', entityId: pdc._id });
  return { id: String(pdc._id), status: 'deposited' };
}

/**
 * Clearing records the receipt. The cheque is first locked (`clearing`) with a conditional update,
 * so two clicks can never create two receipts; if the receipt fails the lock is released.
 */
export async function clearPdc(ctx: TenantContext, id: string, input: { clearedOn: string }) {
  const pdc = await loadPdc(ctx, id);
  const previous = pdc.status;
  await movePdc(ctx, pdc._id, ['received', 'deposited'], 'clearing', {});
  try {
    const payment = (await recordPayment(ctx, {
      bookingId: String(pdc.bookingId),
      amountPaise: pdc.amountPaise,
      mode: 'cheque',
      receivedOn: input.clearedOn,
      reference: `Chq ${pdc.chequeNumber}`,
      bankName: pdc.bankName,
      depositAccountId: pdc.depositAccountId ? String(pdc.depositAccountId) : undefined,
      remarks: 'Post-dated cheque cleared',
    })) as { id?: string; _id?: Types.ObjectId; number: string };
    const paymentId = payment.id ?? String(payment._id);
    await Pdc.updateOne(
      { companyId: ctx.companyId, _id: pdc._id, status: 'clearing' },
      {
        $set: { status: 'cleared', clearedOn: day(input.clearedOn), paymentId: toObjectId(paymentId) },
        $push: { history: { status: 'cleared', note: payment.number, by: ctx.userId } },
      },
    );
    await audit(ctx, { action: 'pdc.clear', entityType: 'pdc', entityId: pdc._id, summary: `Receipt ${payment.number}` });
    return { id: String(pdc._id), status: 'cleared', paymentId, receiptNumber: payment.number };
  } catch (err) {
    await Pdc.updateOne({ companyId: ctx.companyId, _id: pdc._id, status: 'clearing' }, { $set: { status: previous } });
    throw err;
  }
}

export async function bouncePdc(ctx: TenantContext, id: string, input: { bouncedOn: string; reason: string }) {
  const pdc = await loadPdc(ctx, id);
  await movePdc(
    ctx,
    pdc._id,
    ['received', 'deposited'],
    'bounced',
    { bouncedOn: day(input.bouncedOn), bounceReason: input.reason },
    input.reason,
  );
  await audit(ctx, { action: 'pdc.bounce', entityType: 'pdc', entityId: pdc._id, changes: input });
  return { id: String(pdc._id), status: 'bounced' };
}

export async function returnPdc(ctx: TenantContext, id: string, reason: string) {
  const pdc = await loadPdc(ctx, id);
  await movePdc(ctx, pdc._id, ['received', 'bounced'], 'returned', {}, reason);
  await audit(ctx, { action: 'pdc.return', entityType: 'pdc', entityId: pdc._id, changes: { reason } });
  return { id: String(pdc._id), status: 'returned' };
}

// =====================================================================
// Vendor & contractor payments (all vendors)
// =====================================================================

export async function listVendorPayments(
  ctx: TenantContext,
  q: { page: number; pageSize: number; sort?: string; q?: string; vendorId?: string; projectId?: string; from?: string; to?: string },
) {
  const filter: Record<string, unknown> = { companyId: ctx.companyId };
  if (q.projectId) {
    assertProjectAccess(ctx, q.projectId);
    filter.projectId = toObjectId(q.projectId);
  } else if (ctx.projectScope !== null) filter.projectId = { $in: ctx.projectScope };
  if (q.vendorId) filter.vendorId = toObjectId(q.vendorId);
  if (q.from || q.to) filter.date = { ...(q.from ? { $gte: day(q.from) } : {}), ...(q.to ? { $lte: day(q.to) } : {}) };
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ number: rx }, { reference: rx }];
  }
  const sort = parseSort(q.sort, ['date', 'amountPaise', 'number'], { date: -1, createdAt: -1 });
  const [items, total, totals] = await Promise.all([
    VendorPayment.find(filter)
      .sort(sort)
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .populate({ path: 'vendorId', select: 'name category', match: { companyId: ctx.companyId } })
      .populate({ path: 'projectId', select: 'name code', match: { companyId: ctx.companyId } })
      .populate({ path: 'accountId', select: 'code name', match: { companyId: ctx.companyId } })
      .lean(),
    VendorPayment.countDocuments(filter),
    VendorPayment.aggregate<{ amount: number }>([{ $match: filter }, { $group: { _id: null, amount: { $sum: '$amountPaise' } } }]),
  ]);
  return { items, meta: pageMeta(q.page, q.pageSize, total), totalPaise: totals[0]?.amount ?? 0 };
}

// =====================================================================
// Ledger adjustments (credit / debit notes on a booking)
// =====================================================================

const DEFAULT_ADJ_ACCOUNT: Record<string, SystemAccountKey> = {
  discount: 'discount_allowed',
  waiver: 'discount_allowed',
  rounding: 'discount_allowed',
  interest: 'interest_income',
  late_fee: 'interest_income',
  other: 'other_income',
};

async function adjustmentAccount(ctx: TenantContext, input: LedgerAdjustmentInput, session: ClientSession) {
  if (!input.accountId) {
    const key =
      input.type === 'debit' && ['discount', 'waiver', 'rounding'].includes(input.reason)
        ? 'other_income'
        : DEFAULT_ADJ_ACCOUNT[input.reason]!;
    return systemAccountId(ctx.companyId, key, session);
  }
  const acc = await Account.findOne({ companyId: ctx.companyId, _id: toObjectId(input.accountId), isActive: true })
    .session(session)
    .lean();
  if (!acc || !['income', 'expense'].includes(acc.type)) throw badRequest('Choose an active income or expense account');
  if (acc.systemKey && CONTROL_ACCOUNT_KEYS.includes(acc.systemKey as SystemAccountKey))
    throw badRequest('Choose an income or expense account');
  return acc._id;
}

function instStatus(amount: number, paid: number) {
  if (paid >= amount) return 'paid';
  return paid > 0 ? 'partial' : 'pending';
}

export async function createAdjustment(ctx: TenantContext, input: LedgerAdjustmentInput) {
  return withTransaction(async (session) => {
    const booking = await Booking.findOne({ companyId: ctx.companyId, _id: toObjectId(input.bookingId) })
      .session(session)
      .lean();
    if (!booking) throw notFound('Booking');
    assertProjectAccess(ctx, booking.projectId);
    if (!['reserved', 'booked'].includes(booking.status)) throw businessRule(`Adjustments cannot be made on a ${booking.status} booking`);
    const accountId = await adjustmentAccount(ctx, input, session);
    const number = await nextDocumentNumber(ctx.companyId, 'ADJ', input.date, session);
    const adjId = new Types.ObjectId();
    const effects: { installmentId: Types.ObjectId; deltaPaise: number; created?: boolean }[] = [];

    if (input.type === 'credit') {
      // Reduce what the customer still owes, latest installments first.
      const open = await Installment.find({ companyId: ctx.companyId, bookingId: booking._id, status: { $in: ['pending', 'partial'] } })
        .sort({ dueDate: -1, sequence: -1 })
        .session(session)
        .lean();
      const outstanding = open.reduce((s, i) => s + (i.amountPaise - i.paidPaise), 0);
      if (input.amountPaise > outstanding) throw businessRule(`A credit note cannot exceed the ${formatINR(outstanding)} still due`);
      let remaining = input.amountPaise;
      for (const inst of open) {
        if (!remaining) break;
        const take = Math.min(inst.amountPaise - inst.paidPaise, remaining);
        if (take <= 0) continue;
        const amount = inst.amountPaise - take;
        const upd = await Installment.updateOne(
          { companyId: ctx.companyId, _id: inst._id, amountPaise: inst.amountPaise, paidPaise: inst.paidPaise },
          { $set: { amountPaise: amount, status: instStatus(amount, inst.paidPaise) } },
          { session },
        );
        if (upd.modifiedCount !== 1) throw businessRule('Installments changed concurrently, please retry');
        effects.push({ installmentId: inst._id, deltaPaise: -take });
        remaining -= take;
      }
    } else {
      const last = await Installment.findOne({ companyId: ctx.companyId, bookingId: booking._id })
        .sort({ sequence: -1 })
        .session(session)
        .lean();
      const [inst] = await Installment.create(
        [
          {
            companyId: ctx.companyId,
            projectId: booking.projectId,
            bookingId: booking._id,
            customerId: booking.customerId,
            sequence: (last?.sequence ?? 0) + 1,
            name: `${titleCase(input.reason)} (${number})`,
            dueDate: day(input.dueDate ?? input.date),
            amountPaise: input.amountPaise,
          },
        ],
        { session },
      );
      effects.push({ installmentId: inst!._id, deltaPaise: input.amountPaise, created: true });
    }

    const receivable = { systemKey: 'customer_receivable' as const, customerId: booking.customerId, bookingId: booking._id };
    const je = await postJournal(
      ctx,
      {
        date: input.date,
        voucherType: 'journal',
        narration: `${input.type === 'credit' ? 'Credit' : 'Debit'} note ${number} on ${booking.bookingNumber}: ${input.narration}`,
        reference: number,
        projectId: booking.projectId,
        lines:
          input.type === 'credit'
            ? [
                { accountId, debitPaise: input.amountPaise },
                { ...receivable, creditPaise: input.amountPaise },
              ]
            : [
                { ...receivable, debitPaise: input.amountPaise },
                { accountId, creditPaise: input.amountPaise },
              ],
        source: { type: 'ledger_adjustment', id: adjId },
        allowControlAccounts: true,
      },
      session,
    );
    const delta = input.type === 'credit' ? -input.amountPaise : input.amountPaise;
    const upd = await Booking.updateOne(
      { companyId: ctx.companyId, _id: booking._id, status: booking.status },
      { $inc: { netAmountPaise: delta, adjustmentsPaise: delta } },
      { session },
    );
    if (upd.modifiedCount !== 1) throw businessRule('Booking changed concurrently, please retry');
    const [adj] = await LedgerAdjustment.create(
      [
        {
          _id: adjId,
          companyId: ctx.companyId,
          number,
          projectId: booking.projectId,
          bookingId: booking._id,
          customerId: booking.customerId,
          type: input.type,
          reason: input.reason,
          amountPaise: input.amountPaise,
          date: day(input.date),
          accountId,
          narration: input.narration,
          effects,
          journalEntryId: je._id,
          createdBy: ctx.userId,
        },
      ],
      { session },
    );
    await audit(
      ctx,
      {
        action: 'accounting.adjustment',
        entityType: 'booking',
        entityId: booking._id,
        summary: `${number} ${input.type} ${formatINR(input.amountPaise)}`,
      },
      session,
    );
    return adj!.toJSON();
  });
}

export async function reverseAdjustment(ctx: TenantContext, id: string, reason: string) {
  return withTransaction(async (session) => {
    const adj = await LedgerAdjustment.findOne({ companyId: ctx.companyId, _id: toObjectId(id) })
      .session(session)
      .lean();
    if (!adj) throw notFound('Adjustment');
    assertProjectAccess(ctx, adj.projectId);
    if (adj.status !== 'posted') throw businessRule('This adjustment has already been reversed');
    const booking = await Booking.findOne({ companyId: ctx.companyId, _id: adj.bookingId }).session(session).lean();
    if (!booking || !['reserved', 'booked'].includes(booking.status)) throw businessRule('The booking is no longer active');

    for (const e of adj.effects) {
      const inst = await Installment.findOne({ companyId: ctx.companyId, _id: e.installmentId }).session(session).lean();
      if (!inst) throw businessRule('An installment changed by this adjustment no longer exists');
      if (e.created) {
        if (inst.paidPaise > 0)
          throw businessRule('The charge has already been (partly) paid; reverse the receipt first or post a credit note');
        await Installment.updateOne(
          { companyId: ctx.companyId, _id: inst._id, paidPaise: 0 },
          { $set: { status: 'cancelled' } },
          { session },
        );
      } else {
        const amount = inst.amountPaise - (e.deltaPaise ?? 0);
        await Installment.updateOne(
          { companyId: ctx.companyId, _id: inst._id, amountPaise: inst.amountPaise },
          { $set: { amountPaise: amount, status: inst.status === 'cancelled' ? 'cancelled' : instStatus(amount, inst.paidPaise) } },
          { session },
        );
      }
    }
    const rev = await reverseJournal(ctx, adj.journalEntryId!, reason, session, todayInIndia());
    const delta = adj.type === 'credit' ? adj.amountPaise : -adj.amountPaise;
    await Booking.updateOne(
      { companyId: ctx.companyId, _id: booking._id },
      { $inc: { netAmountPaise: delta, adjustmentsPaise: delta } },
      { session },
    );
    await LedgerAdjustment.updateOne(
      { companyId: ctx.companyId, _id: adj._id, status: 'posted' },
      { $set: { status: 'reversed', reversal: { at: new Date(), by: ctx.userId, reason, journalEntryId: rev._id } } },
      { session },
    );
    await audit(
      ctx,
      { action: 'accounting.adjustment_reverse', entityType: 'booking', entityId: booking._id, summary: adj.number, changes: { reason } },
      session,
    );
    return { id: String(adj._id), status: 'reversed' };
  });
}

export async function listAdjustments(
  ctx: TenantContext,
  q: { page: number; pageSize: number; sort?: string; q?: string; projectId?: string; bookingId?: string; type?: string },
) {
  const filter = scopedFilter(ctx, q.projectId);
  if (q.bookingId) filter.bookingId = toObjectId(q.bookingId);
  if (q.type) filter.type = q.type;
  if (q.q) filter.number = new RegExp(escapeRegex(q.q), 'i');
  const sort = parseSort(q.sort, ['date', 'amountPaise', 'number'], { date: -1, createdAt: -1 });
  const [items, total] = await Promise.all([
    LedgerAdjustment.find(filter)
      .sort(sort)
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .populate({ path: 'bookingId', select: 'bookingNumber', match: { companyId: ctx.companyId } })
      .populate({ path: 'customerId', select: 'name', match: { companyId: ctx.companyId } })
      .populate({ path: 'accountId', select: 'code name', match: { companyId: ctx.companyId } })
      .populate({ path: 'createdBy', select: 'name' })
      .lean(),
    LedgerAdjustment.countDocuments(filter),
  ]);
  return { items, meta: pageMeta(q.page, q.pageSize, total) };
}

// =====================================================================
// GST vouchers
// =====================================================================

/** CGST and SGST are each computed at half the rate (as invoiced), IGST at the full rate. */
export function gstSplit(taxablePaise: number, rateBp: number, interState: boolean) {
  if (interState) {
    const igst = applyBasisPoints(taxablePaise, rateBp);
    return { cgst: 0, sgst: 0, igst, total: taxablePaise + igst };
  }
  const half = applyBasisPoints(taxablePaise, rateBp / 2);
  return { cgst: half, sgst: half, igst: 0, total: taxablePaise + 2 * half };
}

export async function createGstVoucher(ctx: TenantContext, input: GstVoucherInput) {
  return withTransaction(async (session) => {
    const acc = await Account.findOne({ companyId: ctx.companyId, _id: toObjectId(input.accountId), isActive: true })
      .session(session)
      .lean();
    const allowed = input.direction === 'output' ? ['income'] : ['expense', 'asset'];
    if (
      !acc ||
      !allowed.includes(acc.type) ||
      (acc.systemKey && (CONTROL_ACCOUNT_KEYS as string[]).includes(acc.systemKey)) ||
      acc.systemKey?.startsWith('gst_')
    ) {
      throw badRequest(input.direction === 'output' ? 'Choose an income account' : 'Choose an expense or asset account');
    }
    if (input.projectId) assertProjectAccess(ctx, input.projectId);
    let vendorId: Types.ObjectId | undefined;
    let settlementAccountId: Types.ObjectId | undefined;
    if (input.vendorId) {
      const vendor = await Vendor.findOne({ companyId: ctx.companyId, _id: toObjectId(input.vendorId) })
        .session(session)
        .lean();
      if (!vendor) throw badRequest('Vendor not found');
      vendorId = vendor._id;
    } else {
      settlementAccountId = await resolveCashAccountFor(ctx.companyId, input.settlementAccountId, input.mode ?? 'neft', session);
    }
    const tax = gstSplit(input.taxableValuePaise, input.rateBp, input.interState);
    const number = await nextDocumentNumber(ctx.companyId, 'GSV', input.date, session);
    const voucherId = new Types.ObjectId();
    const side = input.direction === 'output' ? 'creditPaise' : 'debitPaise';
    const prefix = input.direction === 'output' ? 'gst_output' : 'gst_input';
    const taxLines = [
      { systemKey: `${prefix}_cgst` as SystemAccountKey, [side]: tax.cgst },
      { systemKey: `${prefix}_sgst` as SystemAccountKey, [side]: tax.sgst },
      { systemKey: `${prefix}_igst` as SystemAccountKey, [side]: tax.igst },
    ];
    const counter = vendorId
      ? { systemKey: 'vendor_payable' as const, vendorId, creditPaise: tax.total }
      : input.direction === 'output'
        ? { accountId: settlementAccountId, debitPaise: tax.total }
        : { accountId: settlementAccountId, creditPaise: tax.total };
    const je = await postJournal(
      ctx,
      {
        date: input.date,
        voucherType: vendorId ? 'journal' : input.direction === 'output' ? 'sales' : 'payment',
        narration: `GST ${input.direction === 'output' ? 'sale' : 'purchase'} ${number}: ${input.partyName} inv ${input.invoiceNumber} – ${input.description}`,
        reference: input.invoiceNumber,
        projectId: input.projectId,
        lines: [{ accountId: acc._id, [side]: input.taxableValuePaise }, ...taxLines, counter],
        source: { type: 'gst_voucher', id: voucherId },
        allowControlAccounts: !!vendorId,
      },
      session,
    );
    const [voucher] = await GstVoucher.create(
      [
        {
          _id: voucherId,
          companyId: ctx.companyId,
          number,
          ...input,
          date: day(input.date),
          cgstPaise: tax.cgst,
          sgstPaise: tax.sgst,
          igstPaise: tax.igst,
          totalPaise: tax.total,
          accountId: acc._id,
          settlementAccountId,
          vendorId,
          projectId: input.projectId ? toObjectId(input.projectId) : undefined,
          journalEntryId: je._id,
          createdBy: ctx.userId,
        },
      ],
      { session },
    );
    await audit(
      ctx,
      { action: 'accounting.gst_voucher', entityType: 'gst_voucher', entityId: voucherId, summary: `${number} ${formatINR(tax.total)}` },
      session,
    );
    return voucher!.toJSON();
  });
}

export async function reverseGstVoucher(ctx: TenantContext, id: string, reason: string) {
  return withTransaction(async (session) => {
    const v = await GstVoucher.findOne({ companyId: ctx.companyId, _id: toObjectId(id) })
      .session(session)
      .lean();
    if (!v) throw notFound('GST voucher');
    if (v.status !== 'posted') throw businessRule('This voucher has already been reversed');
    if (v.vendorId) {
      const balance = await partyBalance(ctx.companyId, { vendorId: v.vendorId }, 'vendor_payable', session);
      if (balance < v.totalPaise) throw businessRule('This purchase has already been paid; record a debit note instead');
    }
    const rev = await reverseJournal(ctx, v.journalEntryId!, reason, session, todayInIndia());
    await GstVoucher.updateOne(
      { companyId: ctx.companyId, _id: v._id, status: 'posted' },
      { $set: { status: 'reversed', reversal: { at: new Date(), by: ctx.userId, reason, journalEntryId: rev._id } } },
      { session },
    );
    await audit(
      ctx,
      { action: 'accounting.gst_voucher_reverse', entityType: 'gst_voucher', entityId: v._id, changes: { reason } },
      session,
    );
    return { id: String(v._id), status: 'reversed' };
  });
}

export async function listGstVouchers(
  ctx: TenantContext,
  q: { page: number; pageSize: number; sort?: string; q?: string; direction?: string; from?: string; to?: string },
) {
  const filter: Record<string, unknown> = { companyId: ctx.companyId };
  if (q.direction) filter.direction = q.direction;
  if (q.from || q.to) filter.date = { ...(q.from ? { $gte: day(q.from) } : {}), ...(q.to ? { $lte: day(q.to) } : {}) };
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ number: rx }, { invoiceNumber: rx }, { partyName: rx }, { partyGstin: rx }];
  }
  const sort = parseSort(q.sort, ['date', 'totalPaise', 'number'], { date: -1, createdAt: -1 });
  const [items, total] = await Promise.all([
    GstVoucher.find(filter)
      .sort(sort)
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .populate({ path: 'accountId', select: 'code name', match: { companyId: ctx.companyId } })
      .populate({ path: 'vendorId', select: 'name', match: { companyId: ctx.companyId } })
      .lean(),
    GstVoucher.countDocuments(filter),
  ]);
  return { items, meta: pageMeta(q.page, q.pageSize, total) };
}

/** Output vs input tax for a period, per component, plus a month-wise view. */
export async function gstSummary(ctx: TenantContext, from: string, to: string) {
  const rows = await GstVoucher.aggregate<{
    _id: { direction: string; month: string };
    taxable: number;
    cgst: number;
    sgst: number;
    igst: number;
    count: number;
  }>([
    { $match: { companyId: ctx.companyId, status: 'posted', date: { $gte: day(from), $lte: day(to) } } },
    {
      $group: {
        _id: { direction: '$direction', month: { $dateToString: { format: '%Y-%m', date: '$date' } } },
        taxable: { $sum: '$taxableValuePaise' },
        cgst: { $sum: '$cgstPaise' },
        sgst: { $sum: '$sgstPaise' },
        igst: { $sum: '$igstPaise' },
        count: { $sum: 1 },
      },
    },
    { $sort: { '_id.month': 1 } },
  ]);
  const empty = () => ({ taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, count: 0 });
  const totals = { output: empty(), input: empty() };
  const months = new Map<string, { month: string; outputTaxPaise: number; inputTaxPaise: number }>();
  for (const r of rows) {
    const t = totals[r._id.direction as 'output' | 'input'];
    t.taxablePaise += r.taxable;
    t.cgstPaise += r.cgst;
    t.sgstPaise += r.sgst;
    t.igstPaise += r.igst;
    t.count += r.count;
    const m = months.get(r._id.month) ?? { month: r._id.month, outputTaxPaise: 0, inputTaxPaise: 0 };
    if (r._id.direction === 'output') m.outputTaxPaise += r.cgst + r.sgst + r.igst;
    else m.inputTaxPaise += r.cgst + r.sgst + r.igst;
    months.set(r._id.month, m);
  }
  const net = {
    cgstPaise: totals.output.cgstPaise - totals.input.cgstPaise,
    sgstPaise: totals.output.sgstPaise - totals.input.sgstPaise,
    igstPaise: totals.output.igstPaise - totals.input.igstPaise,
  };
  return { from, to, totals, net, netPayablePaise: net.cgstPaise + net.sgstPaise + net.igstPaise, months: [...months.values()] };
}
