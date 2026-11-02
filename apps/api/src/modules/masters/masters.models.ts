import { model, Schema } from 'mongoose';
import {
  CHARGE_BASES,
  CHARGE_KINDS,
  CONSULTANT_TYPES,
  FINANCER_TYPES,
  PARKING_STATUSES,
  PARKING_TYPES,
  PARTY_KINDS,
  PLOT_CATEGORIES,
  UNIT_TYPES,
} from '@erp/shared';
import { addressDef, baseOptions, tenantRef, withTenant } from '../../db/base';

const ref = (to: string) => ({ type: Schema.Types.ObjectId, ref: to });

/** Land owners, partners and investors. */
const partySchema = withTenant(
  new Schema(
    {
      companyId: tenantRef,
      kind: { type: String, enum: PARTY_KINDS, required: true },
      name: { type: String, required: true, trim: true },
      phone: String,
      email: String,
      pan: String,
      shareBp: Number,
      contributionPaise: Number,
      bankName: String,
      accountNumber: String,
      ifsc: String,
      address: addressDef,
      landParcelIds: [ref('LandParcel')],
      projectIds: [ref('Project')],
      notes: String,
      isActive: { type: Boolean, default: true },
      deletedAt: Date,
      createdBy: ref('User'),
    },
    baseOptions,
  ),
);
partySchema.index({ companyId: 1, kind: 1, name: 1 });
export const Party = model('Party', partySchema);

const financerSchema = withTenant(
  new Schema(
    {
      companyId: tenantRef,
      name: { type: String, required: true, trim: true },
      type: { type: String, enum: FINANCER_TYPES, required: true },
      branch: String,
      contactPerson: String,
      phone: String,
      email: String,
      approvedProjectIds: [ref('Project')],
      interestRateBp: Number,
      notes: String,
      isActive: { type: Boolean, default: true },
      deletedAt: Date,
      createdBy: ref('User'),
    },
    baseOptions,
  ),
);
financerSchema.index({ companyId: 1, name: 1, branch: 1 });
export const Financer = model('Financer', financerSchema);

const consultantSchema = withTenant(
  new Schema(
    {
      companyId: tenantRef,
      name: { type: String, required: true, trim: true },
      type: { type: String, enum: CONSULTANT_TYPES, required: true },
      firm: String,
      phone: String,
      email: String,
      registrationNo: String,
      feeNote: String,
      address: addressDef,
      isActive: { type: Boolean, default: true },
      deletedAt: Date,
      createdBy: ref('User'),
    },
    baseOptions,
  ),
);
consultantSchema.index({ companyId: 1, type: 1, name: 1 });
export const Consultant = model('Consultant', consultantSchema);

/** PLC, club, maintenance and other charges offered on quotations and bookings. */
const chargeMasterSchema = withTenant(
  new Schema(
    {
      companyId: tenantRef,
      projectId: { ...ref('Project'), default: null },
      name: { type: String, required: true, trim: true },
      kind: { type: String, enum: CHARGE_KINDS, required: true },
      basis: { type: String, enum: CHARGE_BASES, required: true },
      value: { type: Number, required: true, min: 0 },
      gstBp: { type: Number, default: 0 },
      isMandatory: { type: Boolean, default: false },
      isActive: { type: Boolean, default: true },
      deletedAt: Date,
      createdBy: ref('User'),
    },
    baseOptions,
  ),
);
chargeMasterSchema.index({ companyId: 1, projectId: 1, name: 1 });
export const ChargeMaster = model('ChargeMaster', chargeMasterSchema);

/** Rate cards. Applying one reprices matching available units. */
const rateIndexSchema = withTenant(
  new Schema(
    {
      companyId: tenantRef,
      projectId: { ...ref('Project'), required: true },
      phaseId: ref('ProjectPhase'),
      blockId: ref('Block'),
      unitType: { type: String, enum: UNIT_TYPES },
      category: { type: String, enum: PLOT_CATEGORIES },
      name: { type: String, required: true, trim: true },
      ratePaisePerSqft: { type: Number, required: true, min: 1 },
      plcBp: Number,
      effectiveFrom: { type: Date, required: true },
      notes: String,
      applications: [
        {
          _id: false,
          at: { type: Date, default: Date.now },
          by: ref('User'),
          unitsRepriced: Number,
        },
      ],
      deletedAt: Date,
      createdBy: ref('User'),
    },
    baseOptions,
  ),
);
rateIndexSchema.index({ companyId: 1, projectId: 1, effectiveFrom: -1 });
export const RateIndex = model('RateIndex', rateIndexSchema);

const parkingSlotSchema = withTenant(
  new Schema(
    {
      companyId: tenantRef,
      projectId: { ...ref('Project'), required: true, immutable: true },
      blockId: ref('Block'),
      code: { type: String, required: true, uppercase: true, trim: true },
      type: { type: String, enum: PARKING_TYPES, required: true },
      level: String,
      pricePaise: { type: Number, default: 0, min: 0 },
      status: { type: String, enum: PARKING_STATUSES, default: 'available', required: true },
      bookingId: { ...ref('Booking'), default: null },
      customerId: ref('Customer'),
      allottedAt: Date,
      remarks: String,
      history: [
        {
          _id: false,
          action: String,
          bookingId: ref('Booking'),
          note: String,
          at: { type: Date, default: Date.now },
          by: ref('User'),
        },
      ],
    },
    baseOptions,
  ),
);
parkingSlotSchema.index({ companyId: 1, projectId: 1, code: 1 }, { unique: true });
parkingSlotSchema.index({ companyId: 1, projectId: 1, status: 1 });
parkingSlotSchema.index({ companyId: 1, bookingId: 1 }, { sparse: true });
export const ParkingSlot = model('ParkingSlot', parkingSlotSchema);
