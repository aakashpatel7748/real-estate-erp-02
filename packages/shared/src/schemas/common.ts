import { z } from 'zod';
import { isISODate } from '../dates';

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
export const isoDate = z.string().refine(isISODate, 'Use a valid date (YYYY-MM-DD)');
/** Integer paise, non-negative. */
export const paise = z.number().int('Amount must be in whole paise').min(0).max(Number.MAX_SAFE_INTEGER);
export const positivePaise = paise.refine((v) => v > 0, 'Amount must be greater than zero');
export const basisPoints = z.number().int().min(0).max(10_000);
export const trimmed = (max = 200) => z.string().trim().max(max);
export const requiredText = (label: string, max = 200) => z.string().trim().min(1, `${label} is required`).max(max);
export const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9\s-]{6,16}$/, 'Enter a valid phone number');
export const email = z.string().trim().toLowerCase().email('Enter a valid email').max(254);
export const pan = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Enter a valid PAN (e.g. ABCDE1234F)');
export const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]Z[0-9A-Z]$/, 'Enter a valid GSTIN');
export const pincode = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]{5}$/, 'Enter a 6-digit PIN code');

export const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' || v === null ? undefined : v), schema.optional());

export const addressSchema = z.object({
  line1: trimmed(200).optional(),
  line2: trimmed(200).optional(),
  city: trimmed(100).optional(),
  state: trimmed(100).optional(),
  pincode: optional(pincode),
});
export type Address = z.infer<typeof addressSchema>;

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z
    .string()
    .regex(/^-?[a-zA-Z0-9_.]+$/)
    .optional(),
  q: z.string().trim().max(100).optional(),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export const idParam = z.object({ id: objectId });

/**
 * Like `schema.partial()` but without defaults: absent keys stay absent, so a PATCH never resets
 * fields the client did not send (Zod's partial() still applies `.default()` values).
 */
export function patchSchema<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, value] of Object.entries(schema.shape)) {
    const field = value instanceof z.ZodDefault ? (value.unwrap() as z.ZodType) : (value as z.ZodType);
    shape[key] = field.optional();
  }
  return z.object(shape) as unknown as z.ZodObject<{ [K in keyof T]: z.ZodOptional<T[K]> }>;
}
