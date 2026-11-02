import { z } from 'zod';
import {
  ADJUSTMENT_REASONS,
  ADJUSTMENT_TYPES,
  CASH_BANK_KINDS,
  CHARGE_BASES,
  CHARGE_KINDS,
  CONSULTANT_TYPES,
  FINANCER_TYPES,
  FOLLOWUP_TYPES,
  GST_DIRECTIONS,
  GST_RATES_BP,
  LEAD_STATUSES,
  LOAN_STATUSES,
  PARKING_STATUSES,
  PARKING_TYPES,
  PARTY_KINDS,
  PAYMENT_MODES,
  PDC_STATUSES,
  PLOT_CATEGORIES,
  PORTALS,
  QUOTATION_STATUSES,
  SALES_DOC_KINDS,
  UNIT_TYPES,
  WHATSAPP_TEMPLATE_CATEGORIES,
} from '../constants/status';
import {
  addressSchema,
  basisPoints,
  email,
  gstin,
  isoDate,
  listQuerySchema,
  objectId,
  optional,
  paise,
  pan,
  phone,
  positivePaise,
  requiredText,
  trimmed,
  patchSchema,
} from './common';
import { bookingChargeSchema } from './sales';

const ifsc = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC (e.g. SBIN0001234)');
const accountNumber = z
  .string()
  .trim()
  .regex(/^[0-9]{6,20}$/, 'Account number should be 6–20 digits');

// ======================= Administration =======================

/** A bank or cash account (an asset account in the chart of accounts). */
export const cashBankAccountSchema = z.object({
  kind: z.enum(CASH_BANK_KINDS),
  name: requiredText('Account name', 120),
  bankName: optional(trimmed(120)),
  accountNumber: optional(accountNumber),
  ifsc: optional(ifsc),
  branch: optional(trimmed(120)),
  accountType: optional(z.enum(['current', 'savings', 'cc', 'od', 'escrow'])),
  /** RERA designated (70%) collection account. */
  isReraAccount: z.boolean().default(false),
  openingBalancePaise: paise.default(0),
  openingDate: optional(isoDate),
});
export type CashBankAccountInput = z.infer<typeof cashBankAccountSchema>;
export const cashBankAccountUpdateSchema = patchSchema(
  cashBankAccountSchema.omit({ kind: true, openingBalancePaise: true, openingDate: true }),
).extend({ isActive: z.boolean().optional() });

export const rateIndexSchema = z.object({
  projectId: objectId,
  phaseId: optional(objectId),
  blockId: optional(objectId),
  unitType: optional(z.enum(UNIT_TYPES)),
  category: optional(z.enum(PLOT_CATEGORIES)),
  name: requiredText('Name', 120),
  ratePaisePerSqft: positivePaise,
  /** Preferential location charge applied together with the rate, if given. */
  plcBp: optional(basisPoints),
  effectiveFrom: isoDate,
  notes: optional(trimmed(500)),
});
export type RateIndexInput = z.infer<typeof rateIndexSchema>;

// ======================= Masters =======================

export const partySchema = z.object({
  kind: z.enum(PARTY_KINDS),
  name: requiredText('Name', 150),
  phone: optional(phone),
  email: optional(email),
  pan: optional(pan),
  /** Partnership / profit share in basis points (partners and investors). */
  shareBp: optional(basisPoints),
  /** Capital or land contribution, for reference. */
  contributionPaise: optional(paise),
  bankName: optional(trimmed(120)),
  accountNumber: optional(accountNumber),
  ifsc: optional(ifsc),
  address: addressSchema.optional(),
  landParcelIds: z.array(objectId).max(50).default([]),
  projectIds: z.array(objectId).max(50).default([]),
  notes: optional(trimmed(1000)),
  isActive: z.boolean().default(true),
});
export type PartyInput = z.infer<typeof partySchema>;

export const financerSchema = z.object({
  name: requiredText('Name', 150),
  type: z.enum(FINANCER_TYPES),
  branch: optional(trimmed(120)),
  contactPerson: optional(trimmed(120)),
  phone: optional(phone),
  email: optional(email),
  /** Projects this lender has approved (APF) for home loans. */
  approvedProjectIds: z.array(objectId).max(100).default([]),
  interestRateBp: optional(basisPoints),
  notes: optional(trimmed(1000)),
  isActive: z.boolean().default(true),
});
export type FinancerInput = z.infer<typeof financerSchema>;

export const consultantSchema = z.object({
  name: requiredText('Name', 150),
  type: z.enum(CONSULTANT_TYPES),
  firm: optional(trimmed(150)),
  phone: optional(phone),
  email: optional(email),
  registrationNo: optional(trimmed(60)),
  feeNote: optional(trimmed(300)),
  address: addressSchema.optional(),
  isActive: z.boolean().default(true),
});
export type ConsultantInput = z.infer<typeof consultantSchema>;

export const chargeMasterBaseSchema = z.object({
  /** Empty = applies to every project. */
  projectId: optional(objectId),
  name: requiredText('Charge name', 80),
  kind: z.enum(CHARGE_KINDS),
  basis: z.enum(CHARGE_BASES),
  /** fixed: paise · per_sqft: paise per sq ft · percent: basis points of the unit value. */
  value: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  gstBp: basisPoints.default(0),
  /** Added automatically to new quotations and bookings. */
  isMandatory: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export const chargeMasterSchema = chargeMasterBaseSchema.refine((v) => v.basis !== 'percent' || v.value <= 10_000, {
  path: ['value'],
  message: 'Percentage cannot exceed 100%',
});
export type ChargeMasterInput = z.infer<typeof chargeMasterSchema>;

export const parkingSlotSchema = z.object({
  projectId: objectId,
  blockId: optional(objectId),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, 'Slot code is required')
    .max(20)
    .regex(/^[A-Z0-9-/]+$/, 'Use letters, digits, - and /'),
  type: z.enum(PARKING_TYPES),
  level: optional(trimmed(20)),
  pricePaise: paise.default(0),
  remarks: optional(trimmed(300)),
});
export type ParkingSlotInput = z.infer<typeof parkingSlotSchema>;
export const parkingBulkSchema = parkingSlotSchema.omit({ code: true }).extend({
  prefix: z
    .string()
    .trim()
    .toUpperCase()
    .max(10)
    .regex(/^[A-Z0-9-/]*$/)
    .default('P-'),
  startNumber: z.number().int().min(1).max(99999),
  count: z.number().int().min(1).max(500),
});
export const parkingAllotSchema = z.object({ bookingId: objectId, remarks: optional(trimmed(300)) });
export const parkingListQuerySchema = listQuerySchema.extend({
  projectId: objectId.optional(),
  status: z.enum(PARKING_STATUSES).optional(),
  type: z.enum(PARKING_TYPES).optional(),
});

export const bookingLoanSchema = z.object({
  financerId: objectId,
  status: z.enum(LOAN_STATUSES),
  loanAccountNo: optional(trimmed(40)),
  sanctionedPaise: optional(paise),
  disbursedPaise: optional(paise),
  sanctionDate: optional(isoDate),
  remarks: optional(trimmed(300)),
});
export type BookingLoanInput = z.infer<typeof bookingLoanSchema>;

export const masterListQuerySchema = listQuerySchema.extend({
  kind: z.string().max(40).optional(),
  type: z.string().max(40).optional(),
  projectId: objectId.optional(),
  active: z.enum(['true', 'false']).optional(),
});

// ======================= Pre sales =======================

export const leadSettingsSchema = z.object({
  sources: z
    .array(
      z.object({
        key: z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z0-9_]{1,40}$/, 'Keys use lowercase letters, digits and _'),
        label: requiredText('Label', 60),
        active: z.boolean().default(true),
      }),
    )
    .min(1)
    .max(50)
    .refine((s) => new Set(s.map((x) => x.key)).size === s.length, 'Source keys must be unique'),
  stageLabels: z.record(z.enum(LEAD_STATUSES), requiredText('Stage label', 40)),
  lostReasons: z.array(requiredText('Reason', 100)).max(30),
});
export type LeadSettingsInput = z.infer<typeof leadSettingsSchema>;

export const whatsappTemplateSchema = z.object({
  name: requiredText('Template name', 80),
  category: z.enum(WHATSAPP_TEMPLATE_CATEGORIES),
  body: requiredText('Message', 2000),
  isActive: z.boolean().default(true),
});
export type WhatsappTemplateInput = z.infer<typeof whatsappTemplateSchema>;
export const whatsappRenderSchema = z.object({
  entityType: z.enum(['lead', 'customer', 'booking']),
  entityId: objectId,
  /** Log the message on the lead timeline (or the booking's follow-ups). */
  log: z.boolean().default(true),
});

export const portalIntegrationSchema = z.object({
  portal: z.enum(PORTALS),
  name: requiredText('Name', 80),
  projectId: optional(objectId),
  defaultAssigneeId: optional(objectId),
  isActive: z.boolean().default(true),
});
export type PortalIntegrationInput = z.infer<typeof portalIntegrationSchema>;

export const quotationSchema = z
  .object({
    projectId: objectId,
    plotIds: z.array(objectId).min(1, 'Select at least one unit').max(20),
    paymentPlanId: objectId,
    leadId: optional(objectId),
    customerId: optional(objectId),
    prospectName: optional(trimmed(120)),
    prospectPhone: optional(phone),
    quoteDate: isoDate,
    validUntil: optional(isoDate),
    discountPaise: paise.default(0),
    charges: z.array(bookingChargeSchema).max(10).default([]),
    notes: optional(trimmed(1000)),
  })
  .refine((v) => v.leadId || v.customerId || v.prospectName, {
    path: ['prospectName'],
    message: 'Choose a lead or customer, or enter the prospect name',
  });
export type QuotationInput = z.infer<typeof quotationSchema>;
export const quotationStatusSchema = z.object({ status: z.enum(QUOTATION_STATUSES) });
export const quotationListQuerySchema = listQuerySchema.extend({
  projectId: objectId.optional(),
  status: z.enum(QUOTATION_STATUSES).optional(),
  leadId: objectId.optional(),
  customerId: objectId.optional(),
});

export const salesDashboardQuerySchema = z.object({
  projectId: objectId.optional(),
  from: optional(isoDate),
  to: optional(isoDate),
});

// ======================= Post sales =======================

const agreementDetails = z.object({
  executedOn: optional(isoDate),
  stampDutyPaise: optional(paise),
  registrationFeePaise: optional(paise),
  registrationNumber: optional(trimmed(60)),
  witnesses: optional(trimmed(300)),
  terms: optional(trimmed(10_000)),
});
const registryDetails = z.object({
  scheduledOn: optional(isoDate),
  registeredOn: optional(isoDate),
  deedNumber: optional(trimmed(60)),
  subRegistrarOffice: optional(trimmed(150)),
  stampDutyPaise: optional(paise),
  registrationFeePaise: optional(paise),
  consultantId: optional(objectId),
});
const possessionDetails = z.object({
  offeredOn: optional(isoDate),
  handedOverOn: optional(isoDate),
  possessionType: optional(z.enum(['physical', 'paper'])),
  keysHandedTo: optional(trimmed(120)),
});

export const salesDocCreateSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('agreement'),
    bookingId: objectId,
    date: isoDate,
    details: agreementDetails.default({}),
    remarks: optional(trimmed(1000)),
  }),
  z.object({
    kind: z.literal('registry'),
    bookingId: objectId,
    date: isoDate,
    details: registryDetails.default({}),
    remarks: optional(trimmed(1000)),
    /** Proceed even though dues are outstanding (needs a remark). */
    overrideDues: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal('possession'),
    bookingId: objectId,
    date: isoDate,
    details: possessionDetails.default({}),
    remarks: optional(trimmed(1000)),
    overrideDues: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal('demand'),
    bookingId: objectId,
    date: isoDate,
    /** Include installments due on or before this date. Defaults to date + company lead days. */
    dueUpTo: optional(isoDate),
    payBy: optional(isoDate),
    remarks: optional(trimmed(1000)),
  }),
]);
export type SalesDocCreateInput = z.infer<typeof salesDocCreateSchema>;
export const salesDocUpdateSchema = z.object({
  status: optional(z.string().max(30)),
  details: z.record(z.string(), z.unknown()).optional(),
  remarks: optional(trimmed(1000)),
  overrideDues: z.boolean().default(false),
});
export const demandBulkSchema = z.object({
  projectId: objectId,
  date: isoDate,
  dueUpTo: optional(isoDate),
  payBy: optional(isoDate),
});
export const salesDocListQuerySchema = listQuerySchema.extend({
  kind: z.enum(SALES_DOC_KINDS),
  projectId: objectId.optional(),
  status: z.string().max(30).optional(),
  bookingId: objectId.optional(),
});

export const followUpSchema = z.object({
  bookingId: objectId,
  type: z.enum(FOLLOWUP_TYPES),
  note: requiredText('Note', 1000),
  promisedAmountPaise: optional(paise),
  promisedOn: optional(isoDate),
  nextFollowUpOn: optional(isoDate),
});
export type FollowUpInput = z.infer<typeof followUpSchema>;
export const duesQuerySchema = listQuerySchema.extend({
  projectId: objectId.optional(),
  bucket: z.enum(['all', 'upcoming', '0_30', '31_60', '61_90', '90_plus']).default('all'),
  followUp: z.enum(['due', 'none']).optional(),
});
export const cancellationsQuerySchema = listQuerySchema.extend({
  projectId: objectId.optional(),
  refund: z.enum(['pending', 'settled']).optional(),
});
export const allotmentQuerySchema = listQuerySchema.extend({
  projectId: objectId.optional(),
  issued: z.enum(['true', 'false']).optional(),
});

// ======================= Account =======================

export const pdcSchema = z.object({
  bookingId: objectId,
  chequeNumber: z
    .string()
    .trim()
    .regex(/^[0-9]{6}$/, 'Cheque number is 6 digits'),
  bankName: requiredText('Bank name', 120),
  branch: optional(trimmed(120)),
  chequeDate: isoDate,
  amountPaise: positivePaise,
  remarks: optional(trimmed(300)),
});
export type PdcInput = z.infer<typeof pdcSchema>;
export const pdcDepositSchema = z.object({ depositedOn: isoDate, depositAccountId: optional(objectId) });
export const pdcClearSchema = z.object({ clearedOn: isoDate });
export const pdcBounceSchema = z.object({ bouncedOn: isoDate, reason: requiredText('Reason', 300) });
export const pdcReturnSchema = z.object({ reason: requiredText('Reason', 300) });
export const pdcListQuerySchema = listQuerySchema.extend({
  projectId: objectId.optional(),
  status: z.enum(PDC_STATUSES).optional(),
  bookingId: objectId.optional(),
  /** Cheques dated on or before today that are still with us. */
  due: z.enum(['true']).optional(),
  from: optional(isoDate),
  to: optional(isoDate),
});

export const ledgerAdjustmentSchema = z.object({
  bookingId: objectId,
  type: z.enum(ADJUSTMENT_TYPES),
  reason: z.enum(ADJUSTMENT_REASONS),
  amountPaise: positivePaise,
  date: isoDate,
  /** The other side of the entry: an income account for debits, an expense/income account for credits. Defaults by reason. */
  accountId: optional(objectId),
  /** Due date of the new charge (debits). Defaults to the adjustment date. */
  dueDate: optional(isoDate),
  narration: requiredText('Narration', 500),
});
export type LedgerAdjustmentInput = z.infer<typeof ledgerAdjustmentSchema>;

export const gstVoucherSchema = z
  .object({
    direction: z.enum(GST_DIRECTIONS),
    date: isoDate,
    invoiceNumber: requiredText('Invoice number', 40),
    partyName: requiredText('Party name', 150),
    partyGstin: optional(gstin),
    placeOfSupply: optional(trimmed(60)),
    interState: z.boolean().default(false),
    hsnSac: optional(trimmed(12)),
    description: requiredText('Description', 300),
    taxableValuePaise: positivePaise,
    rateBp: z
      .number()
      .int()
      .refine((v) => (GST_RATES_BP as readonly number[]).includes(v), 'Choose a GST rate'),
    /** Income account (output) or expense / asset account (input). */
    accountId: objectId,
    /** Settled now through this cash/bank account... */
    settlementAccountId: optional(objectId),
    mode: optional(z.enum(PAYMENT_MODES)),
    /** ...or, for purchases, booked as payable to this vendor. */
    vendorId: optional(objectId),
    projectId: optional(objectId),
  })
  .refine((v) => !(v.vendorId && v.direction === 'output'), { path: ['vendorId'], message: 'Vendors apply to purchase (input) vouchers' });
export type GstVoucherInput = z.infer<typeof gstVoucherSchema>;
export const gstListQuerySchema = listQuerySchema.extend({
  direction: z.enum(GST_DIRECTIONS).optional(),
  from: optional(isoDate),
  to: optional(isoDate),
});
export const vendorPaymentListQuerySchema = listQuerySchema.extend({
  vendorId: objectId.optional(),
  projectId: objectId.optional(),
  from: optional(isoDate),
  to: optional(isoDate),
});
