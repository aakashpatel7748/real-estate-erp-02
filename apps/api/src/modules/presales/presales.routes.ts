import express, { Router } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import {
  idParam,
  leadSettingsSchema,
  patchSchema,
  portalIntegrationSchema,
  quotationListQuerySchema,
  quotationSchema,
  quotationStatusSchema,
  salesDashboardQuerySchema,
  whatsappRenderSchema,
  whatsappTemplateSchema,
  type PortalIntegrationInput,
} from '@erp/shared';
import { authorize } from '../../middleware/auth';
import { body, params, query, validate } from '../../middleware/validate';
import { badRequest } from '../../utils/errors';
import { created, ok } from '../../utils/http';
import { getCtx, toObjectId } from '../../utils/tenant';
import { getLeadSettings, saveLeadSettings } from '../crm/lead-settings';
import { assertRefs, crudRouter } from '../masters/crud';
import { Project } from '../projects/project.models';
import { Membership } from '../users/user.models';
import { PortalIntegration, WhatsappTemplate } from './presales.models';
import * as svc from './presales.service';

type Id = { id: string };

// ---------- Lead stages & sources ----------
export const leadSettingsRouter = Router();
leadSettingsRouter.get('/', authorize('crm.read'), async (req, res) => ok(res, await getLeadSettings(getCtx(req).companyId)));
leadSettingsRouter.put('/', authorize('crm.configure'), validate({ body: leadSettingsSchema }), async (req, res) =>
  ok(res, await saveLeadSettings(getCtx(req).companyId, body(req))),
);

// ---------- WhatsApp templates ----------
export const whatsappTemplatesRouter = crudRouter({
  model: WhatsappTemplate,
  entity: 'Template',
  auditType: 'whatsapp_template',
  createSchema: whatsappTemplateSchema,
  updateSchema: patchSchema(whatsappTemplateSchema),
  permissions: { read: 'crm.read', create: 'crm.configure', update: 'crm.configure', delete: 'crm.configure' },
  searchFields: ['name', 'body'],
  sortFields: ['name', 'category', 'timesUsed', 'createdAt'],
  defaultSort: { category: 1, name: 1 },
  filter: (q) => (q.kind ? { category: q.kind } : {}),
  extend: (r) => {
    r.post('/:id/render', validate({ params: idParam, body: whatsappRenderSchema }), async (req, res) =>
      ok(res, await svc.renderWhatsapp(getCtx(req), params<Id>(req).id, body(req))),
    );
  },
});

// ---------- Portal integrations ----------
async function prepareIntegration(ctx: Parameters<NonNullable<Parameters<typeof crudRouter>[0]['prepare']>>[0], input: Record<string, unknown>) {
  const i = input as Partial<PortalIntegrationInput>;
  if (i.projectId) await assertRefs(ctx, Project, [i.projectId], 'Project', { project: true });
  if (i.defaultAssigneeId && !(await Membership.exists({ companyId: ctx.companyId, userId: toObjectId(i.defaultAssigneeId), status: 'active' }))) {
    throw badRequest('Assignee is not an active member of this company');
  }
  return input;
}
export const integrationsRouter = crudRouter({
  model: PortalIntegration,
  entity: 'Integration',
  auditType: 'integration',
  createSchema: portalIntegrationSchema.transform((v) => ({ ...v, token: svc.newToken() })),
  updateSchema: patchSchema(portalIntegrationSchema),
  permissions: { read: 'crm.configure', create: 'crm.configure', update: 'crm.configure', delete: 'crm.configure' },
  searchFields: ['name', 'portal'],
  sortFields: ['name', 'portal', 'leadsReceived', 'lastReceivedAt', 'createdAt'],
  defaultSort: { createdAt: -1 },
  populate: [{ path: 'projectId', select: 'name code' }, { path: 'defaultAssigneeId', select: 'name' }],
  prepare: prepareIntegration,
  extend: (r) => {
    r.get('/:id/logs', authorize('crm.configure'), validate({ params: idParam }), async (req, res) => ok(res, await svc.integrationLogs(getCtx(req), params<Id>(req).id)));
    r.post('/:id/rotate', authorize('crm.configure'), validate({ params: idParam }), async (req, res) => ok(res, await svc.rotateToken(getCtx(req), params<Id>(req).id)));
    /** Sends a sample enquiry through the same pipeline as the public webhook. */
    r.post(
      '/:id/test',
      authorize('crm.configure'),
      validate({ params: idParam, body: z.object({ name: z.string().max(120), phone: z.string().max(20), message: z.string().max(500).optional() }) }),
      async (req, res) => {
        const ctx = getCtx(req);
        const integration = await PortalIntegration.findOne({ companyId: ctx.companyId, deletedAt: null, _id: toObjectId(params<Id>(req).id) }).lean();
        if (!integration) throw badRequest('Integration not found');
        const result = await svc.receiveInboundLead(integration.token, body(req), req.ip);
        ok(res, result);
      },
    );
  },
});

/**
 * Public inbound endpoint for portals, ad platforms and website forms. Accepts JSON or form posts
 * from any origin; the secret token in the URL is the only credential.
 */
export const inboundRouter = Router();
inboundRouter.use(cors({ origin: true, credentials: false, methods: ['POST', 'OPTIONS'] }));
inboundRouter.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false }));
inboundRouter.post('/:token', express.urlencoded({ extended: false, limit: '100kb' }), async (req, res) => {
  const token = String(req.params.token ?? '');
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Not found' } });
    return;
  }
  const result = await svc.receiveInboundLead(token, req.body, req.ip);
  if (result.status === 404) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Not found' } });
    return;
  }
  if (result.status === 422) {
    res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: result.error } });
    return;
  }
  // Website forms posting directly (no JS) get a plain thank-you page.
  if (req.is('application/x-www-form-urlencoded') && req.accepts(['json', 'html']) === 'html') {
    res.status(200).type('text/plain').send('Thank you! We will contact you shortly.');
    return;
  }
  res.status(result.status).json({ success: true, data: { received: true, duplicate: result.duplicate } });
});

// ---------- Cost sheets & quotations ----------
export const quotationsRouter = Router();
quotationsRouter.get('/', authorize('quotations.read'), validate({ query: quotationListQuerySchema }), async (req, res) => {
  const { items, meta } = await svc.listQuotations(getCtx(req), query(req));
  ok(res, items, meta);
});
quotationsRouter.post('/', authorize('quotations.create'), validate({ body: quotationSchema }), async (req, res) =>
  created(res, await svc.createQuotation(getCtx(req), body(req))),
);
quotationsRouter.get('/:id', authorize('quotations.read'), validate({ params: idParam }), async (req, res) => ok(res, await svc.getQuotation(getCtx(req), params<Id>(req).id)));
quotationsRouter.get('/:id/pdf', authorize('quotations.read'), validate({ params: idParam }), async (req, res) => {
  await svc.quotationPdf(getCtx(req), params<Id>(req).id, res);
});
quotationsRouter.post('/:id/status', authorize('quotations.update'), validate({ params: idParam, body: quotationStatusSchema }), async (req, res) =>
  ok(res, await svc.setQuotationStatus(getCtx(req), params<Id>(req).id, body<{ status: string }>(req).status)),
);

// ---------- Sales dashboard ----------
export const salesDashboardRouter = Router();
salesDashboardRouter.get('/', authorize('crm.read'), validate({ query: salesDashboardQuerySchema }), async (req, res) =>
  ok(res, await svc.salesDashboard(getCtx(req), query(req))),
);
