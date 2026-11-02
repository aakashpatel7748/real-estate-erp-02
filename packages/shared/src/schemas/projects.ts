import { z } from 'zod';
import { PLOT_CATEGORIES, PLOT_FACINGS, PLOT_STATUSES, PROJECT_STATUSES, UNIT_TYPES } from '../constants/status';
import {
  addressSchema,
  basisPoints,
  isoDate,
  listQuerySchema,
  objectId,
  optional,
  paise,
  requiredText,
  trimmed,
  patchSchema,
} from './common';

const code = (label: string) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .min(1, `${label} is required`)
    .max(20)
    .regex(/^[A-Z0-9-/]+$/, `${label} may contain letters, digits, - and /`);

export const projectSchema = z.object({
  name: requiredText('Project name', 150),
  code: code('Project code'),
  status: z.enum(PROJECT_STATUSES).default('planning'),
  description: trimmed(2000).optional(),
  address: addressSchema.optional(),
  reraNumber: trimmed(60).optional(),
  totalAreaX100: z.number().int().min(0).optional(),
  launchDate: optional(isoDate),
  defaultRatePaisePerSqft: paise.optional(),
});
export type ProjectInput = z.infer<typeof projectSchema>;
export const projectUpdateSchema = patchSchema(projectSchema);

export const phaseSchema = z.object({
  name: requiredText('Phase name', 100),
  code: code('Phase code'),
  sequence: z.number().int().min(1).max(999).default(1),
  startDate: optional(isoDate),
  targetDate: optional(isoDate),
});
export type PhaseInput = z.infer<typeof phaseSchema>;

export const blockSchema = z.object({
  phaseId: optional(objectId),
  name: requiredText('Block name', 100),
  code: code('Block code'),
});
export type BlockInput = z.infer<typeof blockSchema>;

export const mapShapeSchema = z.object({
  /** SVG polygon points in map coordinates: "x1,y1 x2,y2 ..." */
  points: z
    .string()
    .trim()
    .max(4000)
    .regex(/^(-?\d+(\.\d+)?,-?\d+(\.\d+)?\s*){3,}$/, 'Polygon needs at least 3 points'),
});

export const plotSchema = z.object({
  phaseId: optional(objectId),
  blockId: optional(objectId),
  plotNumber: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, 'Plot number is required')
    .max(20)
    .regex(/^[A-Z0-9-/]+$/, 'Plot number may contain letters, digits, - and /'),
  category: z.enum(PLOT_CATEGORIES).default('residential'),
  unitType: z.enum(UNIT_TYPES).default('plot'),
  /** Floor number for flats, shops and offices (0 = ground). */
  floor: optional(z.number().int().min(-5).max(200)),
  /** e.g. "2 BHK", "3 BHK + Study". */
  configuration: optional(trimmed(40)),
  facing: optional(z.enum(PLOT_FACINGS)),
  areaX100: z.number().int().positive('Area must be greater than zero'),
  widthFtX100: z.number().int().min(0).optional(),
  depthFtX100: z.number().int().min(0).optional(),
  ratePaisePerSqft: paise,
  /** Preferential location charge in basis points (corner, park-facing, etc.). */
  plcBp: basisPoints.default(0),
  isCorner: z.boolean().default(false),
  remarks: trimmed(500).optional(),
  mapShape: mapShapeSchema.optional(),
});
export type PlotInput = z.infer<typeof plotSchema>;
export const plotUpdateSchema = patchSchema(plotSchema);

export const bulkPlotSchema = z.object({
  phaseId: optional(objectId),
  blockId: optional(objectId),
  prefix: z
    .string()
    .trim()
    .toUpperCase()
    .max(10)
    .regex(/^[A-Z0-9-/]*$/)
    .default(''),
  startNumber: z.number().int().min(1).max(99999),
  count: z.number().int().min(1).max(500),
  category: z.enum(PLOT_CATEGORIES).default('residential'),
  unitType: z.enum(UNIT_TYPES).default('plot'),
  floor: optional(z.number().int().min(-5).max(200)),
  configuration: optional(trimmed(40)),
  areaX100: z.number().int().positive(),
  ratePaisePerSqft: paise,
  plcBp: basisPoints.default(0),
});
export type BulkPlotInput = z.infer<typeof bulkPlotSchema>;

export const plotStatusChangeSchema = z.object({
  status: z.enum(PLOT_STATUSES),
  reason: requiredText('Reason', 300),
});

export const plotListQuerySchema = listQuerySchema.extend({
  status: z.enum(PLOT_STATUSES).optional(),
  phaseId: objectId.optional(),
  blockId: objectId.optional(),
  category: z.enum(PLOT_CATEGORIES).optional(),
  unitType: z.enum(UNIT_TYPES).optional(),
});

export const mapConfigSchema = z.object({
  width: z.number().int().min(100).max(20000),
  height: z.number().int().min(100).max(20000),
  backgroundColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#f8fafc'),
});
export type MapConfig = z.infer<typeof mapConfigSchema>;

export const mapShapesBulkSchema = z.object({
  shapes: z
    .array(z.object({ plotId: objectId, points: mapShapeSchema.shape.points.nullable() }))
    .min(1)
    .max(2000),
});
