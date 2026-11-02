import { Router } from 'express';
import { z } from 'zod';
import {
  ADJUSTMENT_TYPES,
  cashBankAccountSchema,
  cashBankAccountUpdateSchema,
  gstListQuerySchema,
  gstVoucherSchema,
  idParam,
  isoDate,
  ledgerAdjustmentSchema,
  listQuerySchema,
  objectId,
  pdcBounceSchema,
  pdcClearSchema,
  pdcDepositSchema,
  pdcListQuerySchema,
  pdcReturnSchema,
  pdcSchema,
  requiredText,
  todayInIndia,
  vendorPaymentListQuerySchema,
  financialYear,
} from '@erp/shared';
import { authorize } from '../../middleware/auth';
import { idempotent } from '../../middleware/idempotency';
import { body, params, query, validate } from '../../middleware/validate';
import { created, ok } from '../../utils/http';
import { getCtx } from '../../utils/tenant';
import * as svc from './finance.service';

type Id = { id: string };
const reasonBody = z.object({ reason: requiredText('Reason', 500) });

// ---------- Bank & cash accounts ----------
export const cashBankRouter = Router();
cashBankRouter.get('/', authorize('accounting.read'), async (req, res) => ok(res, await svc.listCashBankAccounts(getCtx(req))));
cashBankRouter.post('/', authorize('accounting.manageAccounts'), validate({ body: cashBankAccountSchema }), async (req, res) =>
  created(res, await svc.createCashBankAccount(getCtx(req), body(req))),
);
cashBankRouter.patch(
  '/:id',
  authorize('accounting.manageAccounts'),
  validate({ params: idParam, body: cashBankAccountUpdateSchema }),
  async (req, res) => ok(res, await svc.updateCashBankAccount(getCtx(req), params<Id>(req).id, body(req))),
);

// ---------- Post-dated cheques ----------
export const pdcRouter = Router();
pdcRouter.get('/', authorize('pdc.read'), validate({ query: pdcListQuerySchema }), async (req, res) => {
  const { items, meta } = await svc.listPdcs(getCtx(req), query(req));
  ok(res, items, meta);
});
pdcRouter.get('/summary', authorize('pdc.read'), validate({ query: pdcListQuerySchema }), async (req, res) =>
  ok(res, (await svc.listPdcs(getCtx(req), { ...query<{ page: number }>(req), page: 1, pageSize: 1 })).summary),
);
pdcRouter.post('/', authorize('pdc.create'), validate({ body: pdcSchema }), async (req, res) =>
  created(res, await svc.createPdc(getCtx(req), body(req))),
);
pdcRouter.post('/:id/deposit', authorize('pdc.update'), validate({ params: idParam, body: pdcDepositSchema }), async (req, res) =>
  ok(res, await svc.depositPdc(getCtx(req), params<Id>(req).id, body(req))),
);
pdcRouter.post(
  '/:id/clear',
  authorize('pdc.update', 'payments.create'),
  validate({ params: idParam, body: pdcClearSchema }),
  idempotent,
  async (req, res) => ok(res, await svc.clearPdc(getCtx(req), params<Id>(req).id, body(req))),
);
pdcRouter.post('/:id/bounce', authorize('pdc.update'), validate({ params: idParam, body: pdcBounceSchema }), async (req, res) =>
  ok(res, await svc.bouncePdc(getCtx(req), params<Id>(req).id, body(req))),
);
pdcRouter.post('/:id/return', authorize('pdc.update'), validate({ params: idParam, body: pdcReturnSchema }), async (req, res) =>
  ok(res, await svc.returnPdc(getCtx(req), params<Id>(req).id, body<{ reason: string }>(req).reason)),
);

// ---------- Vendor & contractor payments ----------
export const vendorPaymentsRouter = Router();
vendorPaymentsRouter.get('/', authorize('vendors.read'), validate({ query: vendorPaymentListQuerySchema }), async (req, res) => {
  const { items, meta, totalPaise } = await svc.listVendorPayments(getCtx(req), query(req));
  res.setHeader('x-total-amount', String(totalPaise));
  ok(res, items, meta);
});

// ---------- Ledger adjustments ----------
export const adjustmentsRouter = Router();
adjustmentsRouter.get(
  '/',
  authorize('accounting.read'),
  validate({
    query: listQuerySchema.extend({
      projectId: objectId.optional(),
      bookingId: objectId.optional(),
      type: z.enum(ADJUSTMENT_TYPES).optional(),
    }),
  }),
  async (req, res) => {
    const { items, meta } = await svc.listAdjustments(getCtx(req), query(req));
    ok(res, items, meta);
  },
);
adjustmentsRouter.post('/', authorize('accounting.adjust'), validate({ body: ledgerAdjustmentSchema }), idempotent, async (req, res) =>
  created(res, await svc.createAdjustment(getCtx(req), body(req))),
);
adjustmentsRouter.post('/:id/reverse', authorize('accounting.adjust'), validate({ params: idParam, body: reasonBody }), async (req, res) =>
  ok(res, await svc.reverseAdjustment(getCtx(req), params<Id>(req).id, body<{ reason: string }>(req).reason)),
);

// ---------- GST vouchers ----------
export const gstRouter = Router();
gstRouter.get('/', authorize('accounting.read'), validate({ query: gstListQuerySchema }), async (req, res) => {
  const { items, meta } = await svc.listGstVouchers(getCtx(req), query(req));
  ok(res, items, meta);
});
gstRouter.get(
  '/summary',
  authorize('accounting.read'),
  validate({ query: z.object({ from: isoDate.optional(), to: isoDate.optional() }) }),
  async (req, res) => {
    const q = query<{ from?: string; to?: string }>(req);
    const today = todayInIndia();
    const fyStart = `${financialYear(today).slice(0, 4)}-04-01`;
    ok(res, await svc.gstSummary(getCtx(req), q.from ?? fyStart, q.to ?? today));
  },
);
gstRouter.post('/', authorize('accounting.create'), validate({ body: gstVoucherSchema }), idempotent, async (req, res) =>
  created(res, await svc.createGstVoucher(getCtx(req), body(req))),
);
gstRouter.post('/:id/reverse', authorize('accounting.reverse'), validate({ params: idParam, body: reasonBody }), async (req, res) =>
  ok(res, await svc.reverseGstVoucher(getCtx(req), params<Id>(req).id, body<{ reason: string }>(req).reason)),
);
