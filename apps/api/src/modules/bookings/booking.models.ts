import { model, Schema, type InferSchemaType } from 'mongoose';
import { BOOKING_STATUSES, INSTALLMENT_STATUSES, LOAN_STATUSES } from '@erp/shared';
import { baseOptions, tenantRef, withTenant } from '../../db/base';

const paymentPlanSchema = withTenant(
  new Schema(
    {
      companyId: tenantRef,
      projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
      name: { type: String, required: true, trim: true },
      description: String,
      isActive: { type: Boolean, default: true },
      /** Validated by `paymentPlanSchema` (Zod) before persisting. */
      rules: { type: [Schema.Types.Mixed], required: true },
    },
    baseOptions,
  ),
);
paymentPlanSchema.index({ companyId: 1, name: 1 }, { unique: true });
export const PaymentPlan = model('PaymentPlan', paymentPlanSchema);

const chargeSchema = new Schema(
  { name: { type: String, required: true }, amountPaise: { type: Number, required: true, min: 0 } },
  { _id: false },
);

const bookingSchema = withTenant(
  new Schema(
    {
      companyId: tenantRef,
      projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, immutable: true },
      bookingNumber: { type: String, required: true, immutable: true },
      customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, immutable: true },
      brokerId: { type: Schema.Types.ObjectId, ref: 'Broker' },
      paymentPlanId: { type: Schema.Types.ObjectId, ref: 'PaymentPlan', required: true },
      /** Snapshot of the plan at booking time, so later plan edits never change a schedule. */
      planSnapshot: { name: String, rules: [Schema.Types.Mixed] },
      status: { type: String, enum: BOOKING_STATUSES, required: true },
      bookingDate: { type: Date, required: true },
      reservedUntil: Date,
      confirmedAt: Date,
      closedAt: Date,
      cancellation: {
        reason: String,
        chargePaise: Number,
        by: { type: Schema.Types.ObjectId, ref: 'User' },
        journalEntryIds: [{ type: Schema.Types.ObjectId, ref: 'JournalEntry' }],
      },
      grossAmountPaise: { type: Number, required: true, min: 0 },
      discountPaise: { type: Number, required: true, min: 0, default: 0 },
      charges: { type: [chargeSchema], default: [] },
      chargesTotalPaise: { type: Number, required: true, min: 0, default: 0 },
      netAmountPaise: { type: Number, required: true, min: 0 },
      /** Running totals maintained transactionally by the payments service. */
      receivedPaise: { type: Number, required: true, default: 0 },
      allocatedPaise: { type: Number, required: true, default: 0 },
      /** Received money not allocated to any installment (overpayment held as advance). */
      advancePaise: { type: Number, required: true, default: 0 },
      refundedPaise: { type: Number, required: true, default: 0 },
      /** Money owed back to the customer after cancellation (paid minus charges minus refunds). */
      refundablePaise: { type: Number, required: true, default: 0 },
      salesJournalEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry' },
      /** Net effect of ledger adjustments (debit notes minus credit notes), included in netAmountPaise. */
      adjustmentsPaise: { type: Number, default: 0 },
      quotationId: { type: Schema.Types.ObjectId, ref: 'Quotation' },
      allotment: {
        issuedAt: Date,
        issuedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        deliveredVia: String,
      },
      /** Home loan, if the buyer is financing through a bank / HFC. */
      loan: {
        financerId: { type: Schema.Types.ObjectId, ref: 'Financer' },
        status: { type: String, enum: LOAN_STATUSES },
        loanAccountNo: String,
        sanctionedPaise: Number,
        disbursedPaise: Number,
        sanctionDate: Date,
        remarks: String,
      },
      remarks: String,
      createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    },
    baseOptions,
  ),
);
bookingSchema.index({ companyId: 1, bookingNumber: 1 }, { unique: true });
bookingSchema.index({ companyId: 1, projectId: 1, status: 1, createdAt: -1 });
bookingSchema.index({ companyId: 1, customerId: 1 });
bookingSchema.index({ companyId: 1, 'loan.financerId': 1 }, { sparse: true });
bookingSchema.index({ status: 1, reservedUntil: 1 });
export type BookingDoc = InferSchemaType<typeof bookingSchema>;
export const Booking = model('Booking', bookingSchema);

const bookingItemSchema = withTenant(
  new Schema(
    {
      companyId: tenantRef,
      projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
      bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
      plotId: { type: Schema.Types.ObjectId, ref: 'Plot', required: true },
      plotNumber: { type: String, required: true },
      blockCode: String,
      areaX100: { type: Number, required: true },
      ratePaisePerSqft: { type: Number, required: true },
      plcBp: { type: Number, required: true },
      basePaise: { type: Number, required: true },
      plcPaise: { type: Number, required: true },
      lineTotalPaise: { type: Number, required: true },
      /** True while the booking holds the plot. A partial unique index makes double-booking impossible. */
      active: { type: Boolean, required: true, default: true },
    },
    baseOptions,
  ),
);
bookingItemSchema.index({ plotId: 1 }, { unique: true, partialFilterExpression: { active: true }, name: 'one_active_booking_per_plot' });
bookingItemSchema.index({ companyId: 1, bookingId: 1 });
export const BookingItem = model('BookingItem', bookingItemSchema);

const installmentSchema = withTenant(
  new Schema(
    {
      companyId: tenantRef,
      projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
      bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
      customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
      sequence: { type: Number, required: true },
      name: { type: String, required: true },
      dueDate: { type: Date, required: true },
      amountPaise: { type: Number, required: true, min: 0 },
      paidPaise: { type: Number, required: true, default: 0, min: 0 },
      status: { type: String, enum: INSTALLMENT_STATUSES, default: 'pending', required: true },
      lastReminderOn: Date,
    },
    baseOptions,
  ),
);
installmentSchema.index({ companyId: 1, bookingId: 1, sequence: 1 }, { unique: true });
installmentSchema.index({ companyId: 1, status: 1, dueDate: 1 });
installmentSchema.index({ companyId: 1, projectId: 1, dueDate: 1 });
installmentSchema.path('paidPaise').validate(function (this: { amountPaise: number }, v: number) {
  return v <= this.amountPaise;
}, 'Installment cannot be over-allocated');
export const Installment = model('Installment', installmentSchema);
