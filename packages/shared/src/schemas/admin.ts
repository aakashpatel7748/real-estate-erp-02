import { z } from 'zod';
import { ALL_PERMISSIONS } from '../constants/permissions';
import { OVERPAYMENT_POLICIES } from '../constants/status';
import { addressSchema, email, gstin, objectId, optional, pan, phone, requiredText, trimmed } from './common';

const permissionEnum = z.enum(ALL_PERMISSIONS as [string, ...string[]]);

export const roleSchema = z.object({
  name: requiredText('Role name', 60),
  description: trimmed(300).optional(),
  permissions: z.array(permissionEnum).max(ALL_PERMISSIONS.length),
});
export type RoleInput = z.infer<typeof roleSchema>;

export const projectAccessSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all') }),
  z.object({ mode: z.literal('restricted'), projectIds: z.array(objectId).max(500) }),
]);

export const inviteUserSchema = z.object({
  email,
  roleId: objectId,
  projectAccess: projectAccessSchema.default({ mode: 'all' }),
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

export const updateMembershipSchema = z.object({
  roleId: objectId.optional(),
  projectAccess: projectAccessSchema.optional(),
  status: z.enum(['active', 'disabled']).optional(),
});
export type UpdateMembershipInput = z.infer<typeof updateMembershipSchema>;

export const companyUpdateSchema = z.object({
  name: requiredText('Company name', 150).optional(),
  legalName: trimmed(200).optional(),
  gstin: optional(gstin),
  pan: optional(pan),
  phone: optional(phone),
  email: optional(email),
  address: addressSchema.optional(),
  settings: z
    .object({
      overpaymentPolicy: z.enum(OVERPAYMENT_POLICIES).optional(),
      reservationHoldHours: z
        .number()
        .int()
        .min(1)
        .max(24 * 30)
        .optional(),
      receiptPrefix: z
        .string()
        .trim()
        .regex(/^[A-Z0-9-]{1,10}$/)
        .optional(),
      bookingPrefix: z
        .string()
        .trim()
        .regex(/^[A-Z0-9-]{1,10}$/)
        .optional(),
      /** Quotations expire this many days after they are made. */
      quotationValidityDays: z.number().int().min(1).max(365).optional(),
      /** Demand letters include installments falling due within this many days. */
      demandLeadDays: z.number().int().min(0).max(90).optional(),
      /** Block sale-deed registry / possession while dues are outstanding (an override with a remark is still possible). */
      registryRequiresFullPayment: z.boolean().optional(),
      possessionRequiresFullPayment: z.boolean().optional(),
      /** Interest on overdue installments, in basis points per month, suggested on the dues screen. */
      lateInterestBpPerMonth: z.number().int().min(0).max(1000).optional(),
    })
    .optional(),
});
export type CompanyUpdateInput = z.infer<typeof companyUpdateSchema>;
