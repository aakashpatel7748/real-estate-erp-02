import { model, Schema } from 'mongoose';
import { PORTALS, QUOTATION_STATUSES, WHATSAPP_TEMPLATE_CATEGORIES } from '@erp/shared';
import { baseOptions, tenantRef, withTenant } from '../../db/base';

const ref = (to: string) => ({ type: Schema.Types.ObjectId, ref: to });

const whatsappTemplateSchema = withTenant(
  new Schema(
    {
      companyId: tenantRef,
      name: { type: String, required: true, trim: true },
      category: { type: String, enum: WHATSAPP_TEMPLATE_CATEGORIES, required: true },
      body: { type: String, required: true },
      isActive: { type: Boolean, default: true },
      timesUsed: { type: Number, default: 0 },
      deletedAt: Date,
      createdBy: ref('User'),
    },
    baseOptions,
  ),
);
whatsappTemplateSchema.index({ companyId: 1, category: 1, name: 1 });
export const WhatsappTemplate = model('WhatsappTemplate', whatsappTemplateSchema);

/** An inbound lead channel (property portal, ad platform or website form) with its own secret URL. */
const portalIntegrationSchema = withTenant(
  new Schema(
    {
      companyId: tenantRef,
      portal: { type: String, enum: PORTALS, required: true },
      name: { type: String, required: true, trim: true },
      projectId: ref('Project'),
      defaultAssigneeId: ref('User'),
      /** Random secret in the webhook URL (a capability URL, like a webhook signing secret). Rotatable. */
      token: { type: String, required: true },
      isActive: { type: Boolean, default: true },
      leadsReceived: { type: Number, default: 0 },
      duplicates: { type: Number, default: 0 },
      lastReceivedAt: Date,
      deletedAt: Date,
      createdBy: ref('User'),
    },
    baseOptions,
  ),
);
portalIntegrationSchema.index({ token: 1 }, { unique: true });
portalIntegrationSchema.index({ companyId: 1, portal: 1 });
export const PortalIntegration = model('PortalIntegration', portalIntegrationSchema);

const inboundLogSchema = withTenant(
  new Schema(
    {
      companyId: tenantRef,
      integrationId: { ...ref('PortalIntegration'), required: true },
      outcome: { type: String, enum: ['created', 'duplicate', 'rejected'], required: true },
      leadId: ref('Lead'),
      name: String,
      phone: String,
      error: String,
      /** Truncated copy of what the portal sent, for troubleshooting field mappings. */
      payload: String,
      ip: String,
    },
    { ...baseOptions, timestamps: { createdAt: true, updatedAt: false } },
  ),
);
inboundLogSchema.index({ companyId: 1, integrationId: 1, createdAt: -1 });
inboundLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });
export const InboundLog = model('InboundLog', inboundLogSchema);

const quotationSchema = withTenant(
  new Schema(
    {
      companyId: tenantRef,
      projectId: { ...ref('Project'), required: true },
      number: { type: String, required: true, immutable: true },
      leadId: ref('Lead'),
      customerId: ref('Customer'),
      prospectName: String,
      prospectPhone: String,
      quoteDate: { type: Date, required: true },
      validUntil: { type: Date, required: true },
      paymentPlanId: { ...ref('PaymentPlan'), required: true },
      planName: String,
      plotIds: [ref('Plot')],
      items: { type: [Schema.Types.Mixed], default: [] },
      grossAmountPaise: { type: Number, required: true },
      discountPaise: { type: Number, default: 0 },
      charges: [{ _id: false, name: String, amountPaise: Number }],
      chargesTotalPaise: { type: Number, default: 0 },
      netAmountPaise: { type: Number, required: true },
      schedule: { type: [Schema.Types.Mixed], default: [] },
      status: { type: String, enum: QUOTATION_STATUSES, default: 'draft', required: true },
      bookingId: ref('Booking'),
      notes: String,
      createdBy: ref('User'),
    },
    baseOptions,
  ),
);
quotationSchema.index({ companyId: 1, number: 1 }, { unique: true });
quotationSchema.index({ companyId: 1, projectId: 1, status: 1, createdAt: -1 });
quotationSchema.index({ companyId: 1, leadId: 1 }, { sparse: true });
export const Quotation = model('Quotation', quotationSchema);
