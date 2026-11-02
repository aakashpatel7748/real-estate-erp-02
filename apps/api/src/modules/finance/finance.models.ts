import { model, Schema } from 'mongoose';
import { ADJUSTMENT_REASONS, ADJUSTMENT_TYPES, GST_DIRECTIONS, PDC_STATUSES } from '@erp/shared';
import { baseOptions, tenantRef, withTenant } from '../../db/base';

const ref = (to: string) => ({ type: Schema.Types.ObjectId, ref: to });

/** Post-dated cheques. A receipt is recorded only when the cheque clears. */
const pdcSchema = withTenant(
  new Schema(
    {
      companyId: tenantRef,
      projectId: { ...ref('Project'), required: true },
      bookingId: { ...ref('Booking'), required: true },
      customerId: { ...ref('Customer'), required: true },
      chequeNumber: { type: String, required: true },
      bankName: { type: String, required: true },
      branch: String,
      chequeDate: { type: Date, required: true },
      amountPaise: { type: Number, required: true, min: 1 },
      status: { type: String, enum: PDC_STATUSES, default: 'received', required: true },
      depositedOn: Date,
      depositAccountId: ref('Account'),
      clearedOn: Date,
      paymentId: ref('Payment'),
      bouncedOn: Date,
      bounceReason: String,
      remarks: String,
      history: [{ _id: false, status: String, note: String, at: { type: Date, default: Date.now }, by: ref('User') }],
      createdBy: ref('User'),
    },
    baseOptions,
  ),
);
pdcSchema.index({ companyId: 1, bookingId: 1, chequeNumber: 1, bankName: 1 }, { unique: true });
pdcSchema.index({ companyId: 1, status: 1, chequeDate: 1 });
export const Pdc = model('Pdc', pdcSchema);

/** Credit / debit notes on a booking's customer ledger (waivers, discounts, interest, late fees). */
const ledgerAdjustmentSchema = withTenant(
  new Schema(
    {
      companyId: tenantRef,
      number: { type: String, required: true, immutable: true },
      projectId: { ...ref('Project'), required: true },
      bookingId: { ...ref('Booking'), required: true },
      customerId: { ...ref('Customer'), required: true },
      type: { type: String, enum: ADJUSTMENT_TYPES, required: true, immutable: true },
      reason: { type: String, enum: ADJUSTMENT_REASONS, required: true },
      amountPaise: { type: Number, required: true, min: 1, immutable: true },
      date: { type: Date, required: true },
      accountId: { ...ref('Account'), required: true },
      narration: String,
      /** Installment changes made by this adjustment, so a reversal can undo them exactly. */
      effects: [{ _id: false, installmentId: ref('Installment'), deltaPaise: Number, created: Boolean }],
      journalEntryId: ref('JournalEntry'),
      status: { type: String, enum: ['posted', 'reversed'], default: 'posted' },
      reversal: { at: Date, by: ref('User'), reason: String, journalEntryId: ref('JournalEntry') },
      createdBy: ref('User'),
    },
    baseOptions,
  ),
);
ledgerAdjustmentSchema.index({ companyId: 1, number: 1 }, { unique: true });
ledgerAdjustmentSchema.index({ companyId: 1, bookingId: 1, status: 1 });
export const LedgerAdjustment = model('LedgerAdjustment', ledgerAdjustmentSchema);

const gstVoucherSchema = withTenant(
  new Schema(
    {
      companyId: tenantRef,
      number: { type: String, required: true, immutable: true },
      direction: { type: String, enum: GST_DIRECTIONS, required: true, immutable: true },
      date: { type: Date, required: true },
      invoiceNumber: { type: String, required: true },
      partyName: { type: String, required: true },
      partyGstin: String,
      placeOfSupply: String,
      interState: { type: Boolean, default: false },
      hsnSac: String,
      description: String,
      taxableValuePaise: { type: Number, required: true },
      rateBp: { type: Number, required: true },
      cgstPaise: { type: Number, default: 0 },
      sgstPaise: { type: Number, default: 0 },
      igstPaise: { type: Number, default: 0 },
      totalPaise: { type: Number, required: true },
      accountId: { ...ref('Account'), required: true },
      settlementAccountId: ref('Account'),
      vendorId: ref('Vendor'),
      projectId: ref('Project'),
      journalEntryId: ref('JournalEntry'),
      status: { type: String, enum: ['posted', 'reversed'], default: 'posted' },
      reversal: { at: Date, by: ref('User'), reason: String, journalEntryId: ref('JournalEntry') },
      createdBy: ref('User'),
    },
    baseOptions,
  ),
);
gstVoucherSchema.index({ companyId: 1, number: 1 }, { unique: true });
gstVoucherSchema.index({ companyId: 1, direction: 1, date: -1 });
export const GstVoucher = model('GstVoucher', gstVoucherSchema);
