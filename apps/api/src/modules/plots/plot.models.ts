import { model, Schema, type InferSchemaType } from 'mongoose';
import { PLOT_CATEGORIES, PLOT_FACINGS, PLOT_STATUSES, UNIT_TYPES } from '@erp/shared';
import { baseOptions, tenantRef, withTenant } from '../../db/base';

const plotSchema = withTenant(
  new Schema(
    {
      companyId: tenantRef,
      projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, immutable: true },
      phaseId: { type: Schema.Types.ObjectId, ref: 'ProjectPhase', default: null },
      blockId: { type: Schema.Types.ObjectId, ref: 'Block', default: null },
      plotNumber: { type: String, required: true, uppercase: true, trim: true },
      category: { type: String, enum: PLOT_CATEGORIES, default: 'residential' },
      unitType: { type: String, enum: UNIT_TYPES, default: 'plot' },
      /** Flats, shops and offices: floor number (block = tower). */
      floor: Number,
      configuration: String,
      facing: { type: String, enum: PLOT_FACINGS },
      areaX100: { type: Number, required: true, min: 1, validate: Number.isInteger },
      widthFtX100: { type: Number, min: 0 },
      depthFtX100: { type: Number, min: 0 },
      ratePaisePerSqft: { type: Number, required: true, min: 0, validate: Number.isInteger },
      plcBp: { type: Number, default: 0, min: 0, max: 10_000 },
      isCorner: { type: Boolean, default: false },
      /** Derived: area × rate + PLC. Recomputed by the service whenever inputs change. */
      listPricePaise: { type: Number, required: true, min: 0, validate: Number.isInteger },
      status: { type: String, enum: PLOT_STATUSES, default: 'available', required: true },
      currentBookingId: { type: Schema.Types.ObjectId, ref: 'Booking', default: null },
      mapShape: { points: String },
      remarks: String,
      deletedAt: Date,
    },
    baseOptions,
  ),
);
// A plot number is unique within a block (or within the project when it has no block).
plotSchema.index({ companyId: 1, projectId: 1, blockId: 1, plotNumber: 1 }, { unique: true });
plotSchema.index({ companyId: 1, projectId: 1, status: 1 });
plotSchema.index({ companyId: 1, projectId: 1, unitType: 1 });
plotSchema.index({ companyId: 1, projectId: 1, createdAt: -1 });
export type PlotDoc = InferSchemaType<typeof plotSchema>;
export const Plot = model('Plot', plotSchema);

/** Append-only history of every plot status change. */
const historySchema = withTenant(
  new Schema(
    {
      companyId: tenantRef,
      projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
      plotId: { type: Schema.Types.ObjectId, ref: 'Plot', required: true },
      from: { type: String, enum: [...PLOT_STATUSES, null] },
      to: { type: String, enum: PLOT_STATUSES, required: true },
      reason: String,
      bookingId: { type: Schema.Types.ObjectId, ref: 'Booking' },
      actorId: { type: Schema.Types.ObjectId, ref: 'User' },
    },
    { ...baseOptions, timestamps: { createdAt: true, updatedAt: false } },
  ),
);
historySchema.index({ companyId: 1, plotId: 1, createdAt: -1 });
export const PlotStatusHistory = model('PlotStatusHistory', historySchema);
