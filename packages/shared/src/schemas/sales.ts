import { z } from 'zod';
import { BOOKING_STATUSES, PAYMENT_MODES } from '../constants/status';
import {
  addressSchema,
  basisPoints,
  email,
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

export const coApplicantSchema = z.object({
  name: requiredText('Co-applicant name', 120),
  relation: trimmed(60).optional(),
  phone: optional(phone),
  email: optional(email),
  pan: optional(pan),
  sharePercentBp: basisPoints.optional(),
});

export const customerSchema = z.object({
  name: requiredText('Customer name', 120),
  phone,
  altPhone: optional(phone),
  email: optional(email),
  pan: optional(pan),
  /** Only the last 4 digits of Aadhaar are stored. */
  aadhaarLast4: optional(z.string().regex(/^\d{4}$/, 'Enter the last 4 digits')),
  dateOfBirth: optional(isoDate),
  occupation: trimmed(100).optional(),
  address: addressSchema.optional(),
  coApplicants: z.array(coApplicantSchema).max(5).default([]),
  notes: trimmed(1000).optional(),
});
export type CustomerInput = z.infer<typeof customerSchema>;
export const customerUpdateSchema = patchSchema(customerSchema);

export const bookingChargeSchema = z.object({
  name: requiredText('Charge name', 80),
  amountPaise: paise,
});

export const createBookingSchema = z.object({
  projectId: objectId,
  customerId: objectId,
  plotIds: z.array(objectId).min(1, 'Select at least one plot').max(20),
  paymentPlanId: objectId,
  brokerId: optional(objectId),
  bookingDate: isoDate,
  /** 'reserve' holds the plot until expiry; 'book' confirms immediately. */
  mode: z.enum(['reserve', 'book']).default('book'),
  reservationHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .optional(),
  discountPaise: paise.default(0),
  charges: z.array(bookingChargeSchema).max(10).default([]),
  /** The saved quotation this booking converts, if any. */
  quotationId: optional(objectId),
  remarks: trimmed(1000).optional(),
});
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const cancelBookingSchema = z.object({
  reason: requiredText('Reason', 500),
  /** Amount retained from paid money as cancellation charges. */
  cancellationChargePaise: paise.default(0),
});
export type CancelBookingInput = z.infer<typeof cancelBookingSchema>;

export const bookingListQuerySchema = listQuerySchema.extend({
  status: z.enum(BOOKING_STATUSES).optional(),
  customerId: objectId.optional(),
});

export const quoteSchema = createBookingSchema.pick({
  projectId: true,
  plotIds: true,
  paymentPlanId: true,
  bookingDate: true,
  discountPaise: true,
  charges: true,
});
export type QuoteInput = z.infer<typeof quoteSchema>;

export const recordPaymentSchema = z.object({
  bookingId: objectId,
  amountPaise: positivePaise,
  mode: z.enum(PAYMENT_MODES),
  receivedOn: isoDate,
  reference: trimmed(100).optional(),
  bankName: trimmed(100).optional(),
  /** Deposit account: cash or a bank account (asset). Defaults by mode. */
  depositAccountId: optional(objectId),
  remarks: trimmed(500).optional(),
});
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

export const reversePaymentSchema = z.object({ reason: requiredText('Reason', 500) });

export const refundSchema = z.object({
  amountPaise: positivePaise,
  mode: z.enum(PAYMENT_MODES),
  paidOn: isoDate,
  reference: trimmed(100).optional(),
  fromAccountId: optional(objectId),
  remarks: trimmed(500).optional(),
});
export type RefundInput = z.infer<typeof refundSchema>;

export const paymentListQuerySchema = listQuerySchema.extend({
  bookingId: objectId.optional(),
  customerId: objectId.optional(),
  kind: z.enum(['receipt', 'refund']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
