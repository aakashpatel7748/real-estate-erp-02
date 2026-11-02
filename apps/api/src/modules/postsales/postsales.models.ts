import { model, Schema } from 'mongoose';
import { FOLLOWUP_TYPES, SALES_DOC_KINDS } from '@erp/shared';
import { baseOptions, tenantRef, withTenant } from '../../db/base';

const ref = (to: string) => ({ type: Schema.Types.ObjectId, ref: to });

/**
 * Builder-buyer agreements, sale-deed registries, possession letters and payment demand letters.
 * One collection with a `kind`; kind-specific fields live in `details` (validated by Zod).
 */
const salesDocumentSchema = withTenant(
  new Schema(
    {
      companyId: tenantRef,
      kind: { type: String, enum: SALES_DOC_KINDS, required: true, immutable: true },
      number: { type: String, required: true, immutable: true },
      projectId: { ...ref('Project'), required: true },
      bookingId: { ...ref('Booking'), required: true },
      customerId: { ...ref('Customer'), required: true },
      date: { type: Date, required: true },
      status: { type: String, required: true },
      details: { type: Schema.Types.Mixed, default: {} },
      /** Demand letters: amount demanded. Registry: stamp duty + fees. */
      amountPaise: { type: Number, default: 0 },
      outstandingAtCreationPaise: Number,
      duesOverridden: Boolean,
      remarks: String,
      history: [{ _id: false, status: String, note: String, at: { type: Date, default: Date.now }, by: ref('User') }],
      createdBy: ref('User'),
    },
    baseOptions,
  ),
);
salesDocumentSchema.index({ companyId: 1, number: 1 }, { unique: true });
salesDocumentSchema.index({ companyId: 1, kind: 1, projectId: 1, date: -1 });
salesDocumentSchema.index({ companyId: 1, bookingId: 1, kind: 1 });
export const SalesDocument = model('SalesDocument', salesDocumentSchema);

const followUpSchema = withTenant(
  new Schema(
    {
      companyId: tenantRef,
      projectId: { ...ref('Project'), required: true },
      bookingId: { ...ref('Booking'), required: true },
      customerId: { ...ref('Customer'), required: true },
      type: { type: String, enum: FOLLOWUP_TYPES, required: true },
      note: { type: String, required: true },
      promisedAmountPaise: Number,
      promisedOn: Date,
      nextFollowUpOn: Date,
      createdBy: ref('User'),
    },
    { ...baseOptions, timestamps: { createdAt: true, updatedAt: false } },
  ),
);
followUpSchema.index({ companyId: 1, bookingId: 1, createdAt: -1 });
followUpSchema.index({ companyId: 1, nextFollowUpOn: 1 });
export const CollectionFollowUp = model('CollectionFollowUp', followUpSchema);
