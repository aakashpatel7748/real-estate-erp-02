import { randomBytes } from 'node:crypto';
import type { Response } from 'express';
import PDFDocument from 'pdfkit';
import { Types } from 'mongoose';
import {
  addDays,
  areaToSqft,
  formatDate,
  formatINR,
  OPEN_LEAD_STATUSES,
  parseISODate,
  toISODate,
  todayInIndia,
  type QuotationInput,
} from '@erp/shared';
import { withTransaction } from '../../db/transaction';
import { audit } from '../../utils/audit';
import { badRequest, businessRule, forbidden, notFound } from '../../utils/errors';
import { escapeRegex, pageMeta, parseSort } from '../../utils/http';
import { assertProjectAccess, hasPermission, scopedFilter, toObjectId, type TenantContext } from '../../utils/tenant';
import { nextDocumentNumber } from '../accounting/ledger.service';
import { Booking, BookingItem, Installment } from '../bookings/booking.models';
import { quote } from '../bookings/bookings.service';
import { Company } from '../companies/company.model';
import { Lead, LeadActivity } from '../crm/crm.models';
import { leadVisibility } from '../crm/crm.service';
import { getLeadSettings } from '../crm/lead-settings';
import { Customer } from '../customers/customer.models';
import { Notification } from '../notifications/notification.model';
import { CollectionFollowUp } from '../postsales/postsales.models';
import { Project } from '../projects/project.models';
import { Membership, User } from '../users/user.models';
import { InboundLog, PortalIntegration, Quotation, WhatsappTemplate } from './presales.models';

// =====================================================================
// WhatsApp templates
// =====================================================================

/** India-first: a bare 10-digit mobile gets the +91 country code. */
export function waNumber(phone: string) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  return digits;
}

export function fillTemplate(body: string, vars: Record<string, string>) {
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, key: string) => vars[key] ?? m);
}

async function bookingVars(ctx: TenantContext, bookingId: Types.ObjectId) {
  const booking = await Booking.findOne({ ...scopedFilter(ctx), _id: bookingId }).lean();
  if (!booking) throw notFound('Booking');
  const [items, open] = await Promise.all([
    BookingItem.find({ companyId: ctx.companyId, bookingId, active: true }).select('plotNumber blockCode').lean(),
    Installment.find({ companyId: ctx.companyId, bookingId, status: { $in: ['pending', 'partial'] } })
      .sort({ dueDate: 1 })
      .lean(),
  ]);
  const today = parseISODate(todayInIndia());
  const due = open.filter((i) => i.dueDate <= today).reduce((s, i) => s + i.amountPaise - i.paidPaise, 0);
  const next = open[0];
  return {
    booking,
    vars: {
      booking_no: booking.bookingNumber,
      units: items.map((i) => (i.blockCode ? `${i.blockCode}-${i.plotNumber}` : i.plotNumber)).join(', '),
      amount_due: formatINR(due || (next ? next.amountPaise - next.paidPaise : 0)),
      due_date: next ? formatDate(toISODate(next.dueDate)) : '',
      total_amount: formatINR(booking.netAmountPaise),
    },
  };
}

/** Fills a template for a lead, customer or booking and returns a click-to-chat link (wa.me). */
export async function renderWhatsapp(ctx: TenantContext, templateId: string, input: { entityType: 'lead' | 'customer' | 'booking'; entityId: string; log: boolean }) {
  const tpl = await WhatsappTemplate.findOne({ companyId: ctx.companyId, deletedAt: null, _id: toObjectId(templateId) }).lean();
  if (!tpl) throw notFound('Template');
  const [company, me] = await Promise.all([Company.findById(ctx.companyId).select('name').lean(), User.findById(ctx.userId).select('name').lean()]);
  const vars: Record<string, string> = { company: company?.name ?? '', executive: me?.name ?? '' };
  let phone = '';
  let leadId: Types.ObjectId | undefined;
  let booking: { _id: Types.ObjectId; projectId: Types.ObjectId; customerId: Types.ObjectId } | undefined;
  const id = toObjectId(input.entityId);

  if (input.entityType === 'lead') {
    if (!hasPermission(ctx, 'crm.read')) throw forbidden();
    const lead = await Lead.findOne({ ...leadVisibility(ctx), _id: id }).populate({ path: 'projectId', select: 'name', match: { companyId: ctx.companyId } }).lean();
    if (!lead) throw notFound('Lead');
    Object.assign(vars, { name: lead.name, phone: lead.phone, project: (lead.projectId as unknown as { name?: string })?.name ?? '' });
    phone = lead.phone;
    leadId = lead._id;
  } else {
    if (!hasPermission(ctx, input.entityType === 'booking' ? 'bookings.read' : 'customers.read')) throw forbidden();
    let customerId = id;
    if (input.entityType === 'booking') {
      const b = await bookingVars(ctx, id);
      Object.assign(vars, b.vars);
      booking = b.booking;
      customerId = b.booking.customerId;
      const project = await Project.findOne({ companyId: ctx.companyId, _id: b.booking.projectId }).select('name').lean();
      vars.project = project?.name ?? '';
    }
    const customer = await Customer.findOne({ companyId: ctx.companyId, _id: customerId, deletedAt: null }).lean();
    if (!customer) throw notFound('Customer');
    Object.assign(vars, { name: customer.name, phone: customer.phone });
    phone = customer.phone;
  }

  const text = fillTemplate(tpl.body, vars);
  const url = `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;
  if (input.log) {
    if (leadId) {
      await LeadActivity.create({ companyId: ctx.companyId, leadId, type: 'whatsapp', summary: `WhatsApp sent: ${tpl.name}`, actorId: ctx.userId, completedAt: new Date() });
      await Lead.updateOne({ companyId: ctx.companyId, _id: leadId }, { $set: { lastActivityAt: new Date() } });
    } else if (booking) {
      await CollectionFollowUp.create({
        companyId: ctx.companyId,
        projectId: booking.projectId,
        bookingId: booking._id,
        customerId: booking.customerId,
        type: 'whatsapp',
        note: `WhatsApp sent: ${tpl.name}`,
        createdBy: ctx.userId,
      });
    }
    await WhatsappTemplate.updateOne({ companyId: ctx.companyId, _id: tpl._id }, { $inc: { timesUsed: 1 } });
  }
  return { phone, text, url, missing: [...text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]) };
}

// =====================================================================
// Portal integrations (inbound leads)
// =====================================================================

export const newToken = () => randomBytes(24).toString('base64url');

const FIELD_ALIASES = {
  name: ['name', 'full_name', 'fullname', 'contact_name', 'customer_name', 'sender_name', 'lead_name', 'first_name', 'buyer_name', 'username'],
  phone: ['phone', 'mobile', 'mobile_number', 'phone_number', 'contact_number', 'contact', 'sender_mobile', 'mobileno', 'cell', 'whatsapp'],
  email: ['email', 'email_id', 'emailid', 'sender_email', 'mail'],
  message: ['message', 'query', 'comments', 'comment', 'remarks', 'requirement', 'enquiry', 'enquiry_message', 'description', 'notes'],
  project: ['project', 'project_name', 'property', 'property_name', 'listing', 'listing_title', 'subject'],
  budget: ['budget', 'price', 'max_budget'],
} as const;

function flatten(obj: unknown, out: Record<string, string> = {}, depth = 0): Record<string, string> {
  if (!obj || typeof obj !== 'object' || depth > 3) return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = k.toLowerCase().replace(/[\s-]+/g, '_');
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) flatten(v, out, depth + 1);
    else if (Array.isArray(v)) {
      // Facebook lead ads style: field_data: [{ name, values: [...] }]
      for (const item of v) {
        if (item && typeof item === 'object' && 'name' in item && 'values' in item) {
          const it = item as { name: string; values: unknown[] };
          out[it.name.toLowerCase().replace(/[\s-]+/g, '_')] = String(it.values?.[0] ?? '');
        } else flatten(item, out, depth + 1);
      }
    } else if (v !== undefined && !(key in out)) out[key] = String(v).slice(0, 1000);
  }
  return out;
}

/** Best-effort field mapping for portal / ad / website payloads (JSON or form-encoded). */
export function mapInboundPayload(payload: unknown) {
  const flat = flatten(payload);
  const pick = (aliases: readonly string[]) => {
    for (const a of aliases) if (flat[a]?.trim()) return flat[a].trim();
    return undefined;
  };
  let name = pick(FIELD_ALIASES.name);
  if (name && flat.last_name && !flat.full_name && name === flat.first_name) name = `${name} ${flat.last_name}`.trim();
  const rawPhone = pick(FIELD_ALIASES.phone);
  const phone = rawPhone?.replace(/[^\d+]/g, '');
  return { name, phone, email: pick(FIELD_ALIASES.email), message: pick(FIELD_ALIASES.message), project: pick(FIELD_ALIASES.project), budget: pick(FIELD_ALIASES.budget) };
}

/**
 * Public webhook: the token identifies the company and channel. Creates a lead, or logs a repeat
 * enquiry on an open lead with the same phone. Never reveals anything about the company.
 */
export async function receiveInboundLead(token: string, payload: unknown, ip?: string) {
  const integration = await PortalIntegration.findOne({ token, deletedAt: null }, null, { crossTenant: true }).lean();
  if (!integration || !integration.isActive) return { status: 404 as const };
  const companyId = integration.companyId;
  const mapped = mapInboundPayload(payload);
  const raw = JSON.stringify(payload ?? {}).slice(0, 4000);
  const log = (outcome: 'created' | 'duplicate' | 'rejected', extra: Record<string, unknown> = {}) =>
    InboundLog.create({ companyId, integrationId: integration._id, outcome, name: mapped.name, phone: mapped.phone, payload: raw, ip, ...extra });

  if (!mapped.phone || mapped.phone.replace(/\D/g, '').length < 7) {
    await log('rejected', { error: 'No phone number found in the payload' });
    return { status: 422 as const, error: 'A phone number is required' };
  }
  const name = mapped.name || 'Portal enquiry';
  const settings = await getLeadSettings(companyId);
  const source = settings.sources.some((s) => s.key === integration.portal) ? integration.portal : 'other';
  const actorId = integration.createdBy ?? integration.defaultAssigneeId;
  const summary = [`Enquiry via ${integration.name}`, mapped.project && `for ${mapped.project}`, mapped.message && `– ${mapped.message}`].filter(Boolean).join(' ').slice(0, 1000);

  const digits = mapped.phone.replace(/\D/g, '').slice(-10);
  const existing = await Lead.findOne({ companyId, deletedAt: null, status: { $in: OPEN_LEAD_STATUSES }, phone: new RegExp(`${digits}$`) }).lean();
  if (existing) {
    await LeadActivity.create({ companyId, leadId: existing._id, type: 'note', summary: `Repeat enquiry: ${summary}`, actorId, completedAt: new Date() });
    await Lead.updateOne({ companyId, _id: existing._id }, { $set: { lastActivityAt: new Date() } });
    await PortalIntegration.updateOne({ companyId, _id: integration._id }, { $inc: { duplicates: 1 }, $set: { lastReceivedAt: new Date() } });
    await log('duplicate', { leadId: existing._id });
    return { status: 200 as const, leadId: String(existing._id), duplicate: true };
  }

  const lead = await Lead.create({
    companyId,
    projectId: integration.projectId,
    name: name.slice(0, 120),
    phone: mapped.phone.slice(0, 20),
    email: mapped.email?.slice(0, 254),
    source,
    status: 'new',
    assignedTo: integration.defaultAssigneeId,
    nextFollowUpAt: new Date(),
    notes: mapped.message?.slice(0, 1000),
    lastActivityAt: new Date(),
    createdBy: actorId,
  });
  await LeadActivity.create({ companyId, leadId: lead._id, type: 'note', summary, actorId, completedAt: new Date() });
  await PortalIntegration.updateOne({ companyId, _id: integration._id }, { $inc: { leadsReceived: 1 }, $set: { lastReceivedAt: new Date() } });
  if (integration.defaultAssigneeId) {
    await Notification.create({
      companyId,
      userId: integration.defaultAssigneeId,
      type: 'lead_assigned',
      title: `New ${integration.name} lead: ${lead.name}`,
      body: mapped.message?.slice(0, 200),
      link: `/pre-sales/leads?lead=${lead._id}`,
    });
  }
  await log('created', { leadId: lead._id });
  return { status: 201 as const, leadId: String(lead._id), duplicate: false };
}

export async function integrationLogs(ctx: TenantContext, id: string) {
  const integration = await PortalIntegration.findOne({ companyId: ctx.companyId, deletedAt: null, _id: toObjectId(id) }).lean();
  if (!integration) throw notFound('Integration');
  return InboundLog.find({ companyId: ctx.companyId, integrationId: integration._id }).sort({ createdAt: -1 }).limit(50).lean();
}

export async function rotateToken(ctx: TenantContext, id: string) {
  const token = newToken();
  const res = await PortalIntegration.updateOne({ companyId: ctx.companyId, deletedAt: null, _id: toObjectId(id) }, { $set: { token } });
  if (res.matchedCount !== 1) throw notFound('Integration');
  await audit(ctx, { action: 'integration.rotate', entityType: 'integration', entityId: id });
  return { token };
}

// =====================================================================
// Cost sheets & quotations
// =====================================================================

async function checkProspect(ctx: TenantContext, input: QuotationInput) {
  if (input.leadId && !(await Lead.exists({ ...leadVisibility(ctx), _id: toObjectId(input.leadId) }))) throw badRequest('Lead not found');
  if (input.customerId && !(await Customer.exists({ companyId: ctx.companyId, _id: toObjectId(input.customerId), deletedAt: null }))) {
    throw badRequest('Customer not found');
  }
}

export async function createQuotation(ctx: TenantContext, input: QuotationInput) {
  if (input.discountPaise > 0 && !hasPermission(ctx, 'bookings.discount')) throw forbidden('You are not allowed to give discounts');
  await checkProspect(ctx, input);
  const priced = await quote(ctx, {
    projectId: input.projectId,
    plotIds: input.plotIds,
    paymentPlanId: input.paymentPlanId,
    bookingDate: input.quoteDate,
    discountPaise: input.discountPaise,
    charges: input.charges,
  });
  if (priced.unavailable.length) {
    throw businessRule(`Not available: ${priced.unavailable.map((u) => `${u.plotNumber} (${u.status})`).join(', ')}`);
  }
  const company = await Company.findById(ctx.companyId).select('settings').lean();
  const validUntil = input.validUntil ?? addDays(input.quoteDate, company?.settings?.quotationValidityDays ?? 15);
  if (validUntil < input.quoteDate) throw badRequest('Validity cannot end before the quotation date');
  return withTransaction(async (session) => {
    const number = await nextDocumentNumber(ctx.companyId, 'QTN', input.quoteDate, session);
    const [q] = await Quotation.create(
      [
        {
          companyId: ctx.companyId,
          projectId: toObjectId(input.projectId),
          number,
          leadId: input.leadId ? toObjectId(input.leadId) : undefined,
          customerId: input.customerId ? toObjectId(input.customerId) : undefined,
          prospectName: input.prospectName,
          prospectPhone: input.prospectPhone,
          quoteDate: parseISODate(input.quoteDate),
          validUntil: parseISODate(validUntil),
          paymentPlanId: toObjectId(input.paymentPlanId),
          planName: priced.planName,
          plotIds: input.plotIds.map(toObjectId),
          items: priced.items,
          grossAmountPaise: priced.grossAmountPaise,
          discountPaise: priced.discountPaise,
          charges: priced.charges,
          chargesTotalPaise: priced.chargesTotalPaise,
          netAmountPaise: priced.netAmountPaise,
          schedule: priced.schedule,
          notes: input.notes,
          createdBy: ctx.userId,
        },
      ],
      { session },
    );
    if (input.leadId) {
      await LeadActivity.create(
        [{ companyId: ctx.companyId, leadId: toObjectId(input.leadId), type: 'note', summary: `Quotation ${number} for ${formatINR(priced.netAmountPaise)}`, actorId: ctx.userId, completedAt: new Date() }],
        { session },
      );
    }
    await audit(ctx, { action: 'quotations.create', entityType: 'quotation', entityId: q!._id, summary: `${number} ${formatINR(priced.netAmountPaise)}` }, session);
    return q!.toJSON();
  });
}

const QUOTE_POPULATE = (ctx: TenantContext) => [
  { path: 'projectId', select: 'name code reraNumber', match: { companyId: ctx.companyId } },
  { path: 'leadId', select: 'name phone', match: { companyId: ctx.companyId } },
  { path: 'customerId', select: 'name phone customerCode', match: { companyId: ctx.companyId } },
  { path: 'bookingId', select: 'bookingNumber', match: { companyId: ctx.companyId } },
  { path: 'createdBy', select: 'name' },
];

/** Quotations past their validity are reported as expired without a background job. */
function withExpiry<T extends { status: string; validUntil: Date }>(q: T): T {
  if (['draft', 'sent', 'accepted'].includes(q.status) && toISODate(q.validUntil) < todayInIndia()) return { ...q, status: 'expired' };
  return q;
}

export async function listQuotations(
  ctx: TenantContext,
  q: { page: number; pageSize: number; sort?: string; q?: string; projectId?: string; status?: string; leadId?: string; customerId?: string },
) {
  const filter = scopedFilter(ctx, q.projectId);
  const today = parseISODate(todayInIndia());
  if (q.status === 'expired') Object.assign(filter, { status: { $in: ['draft', 'sent', 'accepted'] }, validUntil: { $lt: today } });
  else if (q.status && ['draft', 'sent', 'accepted'].includes(q.status)) Object.assign(filter, { status: q.status, validUntil: { $gte: today } });
  else if (q.status) filter.status = q.status;
  if (q.leadId) filter.leadId = toObjectId(q.leadId);
  if (q.customerId) filter.customerId = toObjectId(q.customerId);
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ number: rx }, { prospectName: rx }, { prospectPhone: rx }];
  }
  const sort = parseSort(q.sort, ['quoteDate', 'netAmountPaise', 'number', 'validUntil'], { createdAt: -1 });
  const [items, total] = await Promise.all([
    Quotation.find(filter)
      .sort(sort)
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .select('-schedule')
      .populate(QUOTE_POPULATE(ctx))
      .lean(),
    Quotation.countDocuments(filter),
  ]);
  return { items: items.map(withExpiry), meta: pageMeta(q.page, q.pageSize, total) };
}

export async function getQuotation(ctx: TenantContext, id: string) {
  const q = await Quotation.findOne({ ...scopedFilter(ctx), _id: toObjectId(id) })
    .populate(QUOTE_POPULATE(ctx))
    .lean();
  if (!q) throw notFound('Quotation');
  return withExpiry(q);
}

const QUOTE_TRANSITIONS: Record<string, string[]> = { draft: ['sent', 'accepted', 'cancelled'], sent: ['accepted', 'cancelled'], accepted: ['cancelled'] };

export async function setQuotationStatus(ctx: TenantContext, id: string, status: string) {
  const q = await getQuotation(ctx, id);
  if (q.status === 'expired') throw businessRule('This quotation has expired; make a new one');
  if (!QUOTE_TRANSITIONS[q.status]?.includes(status)) throw businessRule(`A ${q.status} quotation cannot be marked ${status}`);
  const res = await Quotation.updateOne({ companyId: ctx.companyId, _id: q._id, status: q.status }, { $set: { status } });
  if (res.modifiedCount !== 1) throw businessRule('The quotation changed concurrently, please retry');
  await audit(ctx, { action: 'quotations.status', entityType: 'quotation', entityId: q._id, changes: { from: q.status, to: status } });
  return { id: String(q._id), status };
}

const rs = (paise: number) => `Rs. ${formatINR(paise, { symbol: false })}`;

export async function quotationPdf(ctx: TenantContext, id: string, res: Response) {
  const q = (await getQuotation(ctx, id)) as unknown as {
    number: string;
    status: string;
    quoteDate: Date;
    validUntil: Date;
    planName: string;
    prospectName?: string;
    prospectPhone?: string;
    leadId?: { name: string; phone: string };
    customerId?: { name: string; phone: string };
    projectId?: { name: string; reraNumber?: string };
    items: { plotNumber: string; blockCode?: string; areaX100: number; ratePaisePerSqft: number; plcPaise: number; lineTotalPaise: number }[];
    grossAmountPaise: number;
    discountPaise: number;
    charges: { name: string; amountPaise: number }[];
    netAmountPaise: number;
    schedule: { sequence: number; name: string; dueDate: string; amountPaise: number }[];
    notes?: string;
  };
  const company = await Company.findById(ctx.companyId).lean();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${q.number.replace(/[^\w.-]/g, '_')}.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(res);
  doc.fontSize(16).font('Helvetica-Bold').text(company?.legalName || company?.name || '');
  doc.fontSize(9).font('Helvetica').fillColor('#555');
  const addr = [company?.address?.line1, company?.address?.city, company?.address?.state].filter(Boolean).join(', ');
  if (addr) doc.text(addr);
  if (company?.phone) doc.text(`Phone: ${company.phone}`);
  doc.moveDown(0.8).fillColor('#000').fontSize(13).font('Helvetica-Bold').text('COST SHEET / QUOTATION', { align: 'center' }).moveDown(0.6);
  const row = (label: string, value: string) => {
    const y = doc.y;
    doc.fontSize(10).font('Helvetica-Bold').text(label, 50, y, { width: 160 });
    doc.font('Helvetica').text(value, 210, y, { width: 335 });
    doc.moveDown(0.3);
  };
  const prospect = q.customerId ?? q.leadId;
  row('Quotation No.', q.number);
  row('Date', formatDate(toISODate(q.quoteDate)));
  row('Valid until', formatDate(toISODate(q.validUntil)));
  row('Prepared for', `${prospect?.name ?? q.prospectName ?? ''}${(prospect?.phone ?? q.prospectPhone) ? ` (${prospect?.phone ?? q.prospectPhone})` : ''}`);
  row('Project', `${q.projectId?.name ?? ''}${q.projectId?.reraNumber ? ` – RERA ${q.projectId.reraNumber}` : ''}`);
  doc.moveDown(0.4).font('Helvetica-Bold').text('Unit pricing').font('Helvetica').moveDown(0.3);
  for (const i of q.items) {
    row(
      `Unit ${i.blockCode ? `${i.blockCode}-` : ''}${i.plotNumber}`,
      `${areaToSqft(i.areaX100)} sq ft @ ${rs(i.ratePaisePerSqft)}/sq ft${i.plcPaise ? ` + PLC ${rs(i.plcPaise)}` : ''} = ${rs(i.lineTotalPaise)}`,
    );
  }
  row('Unit value', rs(q.grossAmountPaise));
  if (q.discountPaise) row('Discount', `- ${rs(q.discountPaise)}`);
  for (const c of q.charges) row(c.name, rs(c.amountPaise));
  doc.font('Helvetica-Bold');
  row('Total cost', rs(q.netAmountPaise));
  doc.moveDown(0.4).font('Helvetica-Bold').text(`Payment plan: ${q.planName}`).font('Helvetica').moveDown(0.3);
  for (const s of q.schedule) row(`${s.sequence}. ${s.name}`, `${formatDate(s.dueDate)} – ${rs(s.amountPaise)}`);
  if (q.notes) doc.moveDown(0.5).font('Helvetica-Bold').text('Notes').font('Helvetica').text(q.notes);
  doc
    .moveDown(1.5)
    .fontSize(8)
    .fillColor('#666')
    .text('Prices are subject to availability at the time of booking. Government taxes, stamp duty and registration charges extra unless stated.', { align: 'center' });
  doc.end();
}

// =====================================================================
// Sales dashboard
// =====================================================================

export async function salesDashboard(ctx: TenantContext, q: { projectId?: string; from?: string; to?: string }) {
  const today = todayInIndia();
  const to = q.to ?? today;
  const from = q.from ?? `${to.slice(0, 7)}-01`;
  const fromD = parseISODate(from);
  const toEnd = new Date(parseISODate(to).getTime() + 86_400_000);
  const leadBase: Record<string, unknown> = { ...leadVisibility(ctx) };
  if (q.projectId) {
    assertProjectAccess(ctx, q.projectId);
    leadBase.projectId = toObjectId(q.projectId);
  }
  const bookingBase = scopedFilter(ctx, q.projectId);
  const inPeriod = { createdAt: { $gte: fromD, $lt: toEnd } };
  const twelveWeeksAgo = new Date(toEnd.getTime() - 12 * 7 * 86_400_000);
  const endOfToday = new Date(parseISODate(today).getTime() + 86_400_000);

  const [bySource, byStatus, pipeline, followUps, trendLeads, trendBookings, bookings, quotes, visits, execLeads, execBookings, settings] = await Promise.all([
    Lead.aggregate<{ _id: string; n: number; won: number }>([
      { $match: { ...leadBase, ...inPeriod } },
      { $group: { _id: '$source', n: { $sum: 1 }, won: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] } } } },
      { $sort: { n: -1 } },
    ]),
    Lead.aggregate<{ _id: string; n: number }>([{ $match: { ...leadBase, ...inPeriod } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Lead.aggregate<{ _id: string; n: number }>([{ $match: { ...leadBase, status: { $in: OPEN_LEAD_STATUSES } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Lead.aggregate<{ overdue: number; today: number }>([
      { $match: { ...leadBase, status: { $in: OPEN_LEAD_STATUSES }, nextFollowUpAt: { $lt: endOfToday } } },
      {
        $group: {
          _id: null,
          overdue: { $sum: { $cond: [{ $lt: ['$nextFollowUpAt', parseISODate(today)] }, 1, 0] } },
          today: { $sum: { $cond: [{ $gte: ['$nextFollowUpAt', parseISODate(today)] }, 1, 0] } },
        },
      },
    ]),
    Lead.aggregate<{ _id: string; n: number }>([
      { $match: { ...leadBase, createdAt: { $gte: twelveWeeksAgo, $lt: toEnd } } },
      { $group: { _id: { $dateToString: { format: '%G-W%V', date: '$createdAt', timezone: 'Asia/Kolkata' } }, n: { $sum: 1 } } },
    ]),
    Booking.aggregate<{ _id: string; n: number; value: number }>([
      { $match: { ...bookingBase, bookingDate: { $gte: twelveWeeksAgo, $lt: toEnd }, status: { $in: ['reserved', 'booked'] } } },
      { $group: { _id: { $dateToString: { format: '%G-W%V', date: '$bookingDate' } }, n: { $sum: 1 }, value: { $sum: '$netAmountPaise' } } },
    ]),
    Booking.aggregate<{ n: number; value: number; cancelled: number }>([
      { $match: { ...bookingBase, bookingDate: { $gte: fromD, $lt: toEnd } } },
      {
        $group: {
          _id: null,
          n: { $sum: { $cond: [{ $in: ['$status', ['reserved', 'booked']] }, 1, 0] } },
          value: { $sum: { $cond: [{ $in: ['$status', ['reserved', 'booked']] }, '$netAmountPaise', 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
        },
      },
    ]),
    Quotation.aggregate<{ n: number; value: number; converted: number }>([
      { $match: { ...bookingBase, quoteDate: { $gte: fromD, $lt: toEnd } } },
      { $group: { _id: null, n: { $sum: 1 }, value: { $sum: '$netAmountPaise' }, converted: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] } } } },
    ]),
    LeadActivity.countDocuments({ companyId: ctx.companyId, type: 'site_visit', createdAt: { $gte: fromD, $lt: toEnd } }),
    Lead.aggregate<{ _id: Types.ObjectId | null; open: number; won: number; total: number }>([
      { $match: { ...leadBase, ...inPeriod } },
      {
        $group: {
          _id: '$assignedTo',
          total: { $sum: 1 },
          open: { $sum: { $cond: [{ $in: ['$status', OPEN_LEAD_STATUSES] }, 1, 0] } },
          won: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] } },
        },
      },
    ]),
    Booking.aggregate<{ _id: Types.ObjectId; n: number; value: number }>([
      { $match: { ...bookingBase, bookingDate: { $gte: fromD, $lt: toEnd }, status: { $in: ['reserved', 'booked'] } } },
      { $group: { _id: '$createdBy', n: { $sum: 1 }, value: { $sum: '$netAmountPaise' } } },
    ]),
    getLeadSettings(ctx.companyId),
  ]);

  const userIds = [...new Set([...execLeads.map((e) => e._id), ...execBookings.map((e) => e._id)].filter(Boolean).map(String))];
  const [users, members] = await Promise.all([
    User.find({ _id: { $in: userIds.map((i) => new Types.ObjectId(i)) } }).select('name').lean(),
    Membership.find({ companyId: ctx.companyId, userId: { $in: userIds.map((i) => new Types.ObjectId(i)) } }).select('userId').lean(),
  ]);
  const memberSet = new Set(members.map((m) => String(m.userId)));
  const names = new Map(users.filter((u) => memberSet.has(String(u._id))).map((u) => [String(u._id), u.name]));
  const execMap = new Map<string, { userId: string | null; name: string; leads: number; open: number; won: number; bookings: number; valuePaise: number }>();
  for (const e of execLeads) {
    const key = e._id ? String(e._id) : 'unassigned';
    execMap.set(key, { userId: e._id ? String(e._id) : null, name: e._id ? (names.get(String(e._id)) ?? 'Former user') : 'Unassigned', leads: e.total, open: e.open, won: e.won, bookings: 0, valuePaise: 0 });
  }
  for (const b of execBookings) {
    const key = String(b._id);
    const row = execMap.get(key) ?? { userId: key, name: names.get(key) ?? 'Former user', leads: 0, open: 0, won: 0, bookings: 0, valuePaise: 0 };
    row.bookings = b.n;
    row.valuePaise = b.value;
    execMap.set(key, row);
  }

  const totalLeads = bySource.reduce((s, r) => s + r.n, 0);
  const won = byStatus.find((s) => s._id === 'won')?.n ?? 0;
  const label = (k: string) => settings.sources.find((s) => s.key === k)?.label ?? k;
  const weeks = new Map<string, { week: string; leads: number; bookings: number; valuePaise: number }>();
  for (const t of trendLeads) weeks.set(t._id, { week: t._id, leads: t.n, bookings: 0, valuePaise: 0 });
  for (const t of trendBookings) {
    const w = weeks.get(t._id) ?? { week: t._id, leads: 0, bookings: 0, valuePaise: 0 };
    w.bookings = t.n;
    w.valuePaise = t.value;
    weeks.set(t._id, w);
  }
  return {
    from,
    to,
    kpis: {
      leads: totalLeads,
      won,
      conversionBp: totalLeads ? Math.round((won * 10_000) / totalLeads) : 0,
      siteVisits: visits,
      bookings: bookings[0]?.n ?? 0,
      bookingValuePaise: bookings[0]?.value ?? 0,
      cancellations: bookings[0]?.cancelled ?? 0,
      quotations: quotes[0]?.n ?? 0,
      quotationValuePaise: quotes[0]?.value ?? 0,
      quotationsConverted: quotes[0]?.converted ?? 0,
      followUpsOverdue: followUps[0]?.overdue ?? 0,
      followUpsToday: followUps[0]?.today ?? 0,
    },
    bySource: bySource.map((s) => ({ source: s._id, label: label(s._id), leads: s.n, won: s.won })),
    byStatus: byStatus.map((s) => ({ status: s._id, label: settings.stageLabels[s._id] ?? s._id, leads: s.n })),
    pipeline: OPEN_LEAD_STATUSES.map((s) => ({ status: s, label: settings.stageLabels[s] ?? s, leads: pipeline.find((p) => p._id === s)?.n ?? 0 })),
    trend: [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week)),
    executives: [...execMap.values()].sort((a, b) => b.valuePaise - a.valuePaise || b.won - a.won),
  };
}
