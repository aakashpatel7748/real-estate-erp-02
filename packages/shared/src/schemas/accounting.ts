import { z } from 'zod';
import { ACCOUNT_TYPES } from '../constants/status';
import { isoDate, listQuerySchema, objectId, optional, paise, requiredText, trimmed, patchSchema } from './common';

export const accountSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[0-9A-Z-]{1,12}$/, 'Code may contain digits, capitals and -'),
  name: requiredText('Account name', 120),
  type: z.enum(ACCOUNT_TYPES),
  parentId: optional(objectId),
  description: trimmed(300).optional(),
  isBank: z.boolean().default(false),
});
export type AccountInput = z.infer<typeof accountSchema>;
export const accountUpdateSchema = patchSchema(accountSchema.pick({ name: true, description: true })).extend({
  isActive: z.boolean().optional(),
});

export const journalLineSchema = z
  .object({
    accountId: objectId,
    debitPaise: paise.default(0),
    creditPaise: paise.default(0),
    narration: trimmed(200).optional(),
  })
  .refine((l) => l.debitPaise > 0 !== l.creditPaise > 0, 'Each line needs either a debit or a credit');

export const journalEntrySchema = z
  .object({
    date: isoDate,
    projectId: optional(objectId),
    narration: requiredText('Narration', 500),
    reference: trimmed(100).optional(),
    lines: z.array(journalLineSchema).min(2, 'At least two lines are required').max(50),
  })
  .refine((e) => e.lines.reduce((s, l) => s + l.debitPaise, 0) === e.lines.reduce((s, l) => s + l.creditPaise, 0), {
    message: 'Debits and credits must be equal',
    path: ['lines'],
  });
export type JournalEntryInput = z.infer<typeof journalEntrySchema>;

export const reverseEntrySchema = z.object({
  reason: requiredText('Reason', 500),
  date: optional(isoDate),
});

export const journalListQuerySchema = listQuerySchema.extend({
  from: isoDate.optional(),
  to: isoDate.optional(),
  accountId: objectId.optional(),
  voucherType: z.string().max(20).optional(),
});

export const reportRangeSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  projectId: objectId.optional(),
});
export const asOfSchema = z.object({ asOf: isoDate.optional(), projectId: objectId.optional() });
