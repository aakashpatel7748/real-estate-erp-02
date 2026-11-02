import { Router } from 'express';
import { z } from 'zod';
import {
  allotmentQuerySchema,
  bookingLoanSchema,
  cancellationsQuerySchema,
  demandBulkSchema,
  duesQuerySchema,
  followUpSchema,
  idParam,
  objectId,
  salesDocCreateSchema,
  salesDocListQuerySchema,
  salesDocUpdateSchema,
  trimmed,
} from '@erp/shared';
import { authorize } from '../../middleware/auth';
import { body, params, query, validate } from '../../middleware/validate';
import { created, ok } from '../../utils/http';
import { getCtx } from '../../utils/tenant';
import * as svc from './postsales.service';

type Id = { id: string };
export const postSalesRouter = Router();

// Home loan on a booking
postSalesRouter.put(
  '/bookings/:id/loan',
  authorize('postSales.update'),
  validate({ params: idParam, body: bookingLoanSchema.nullable() }),
  async (req, res) => ok(res, await svc.setBookingLoan(getCtx(req), params<Id>(req).id, body(req))),
);

// Allotment letters
postSalesRouter.get('/allotments', authorize('postSales.read'), validate({ query: allotmentQuerySchema }), async (req, res) => {
  const { items, meta } = await svc.listAllotments(getCtx(req), query(req));
  ok(res, items, meta);
});
postSalesRouter.get('/allotments/summary', authorize('postSales.read'), validate({ query: allotmentQuerySchema }), async (req, res) =>
  ok(res, (await svc.listAllotments(getCtx(req), { ...query<{ page: number }>(req), page: 1, pageSize: 1 })).summary),
);
postSalesRouter.post(
  '/bookings/:id/allotment',
  authorize('postSales.update'),
  validate({ params: idParam, body: z.object({ issued: z.boolean(), via: trimmed(40).optional() }) }),
  async (req, res) => {
    const b = body<{ issued: boolean; via?: string }>(req);
    ok(res, await svc.markAllotmentIssued(getCtx(req), params<Id>(req).id, b.issued, b.via));
  },
);

// Booking cancellations
postSalesRouter.get('/cancellations', authorize('bookings.read'), validate({ query: cancellationsQuerySchema }), async (req, res) => {
  const { items, meta } = await svc.listCancellations(getCtx(req), query(req));
  ok(res, items, meta);
});
postSalesRouter.get('/cancellations/summary', authorize('bookings.read'), validate({ query: cancellationsQuerySchema }), async (req, res) =>
  ok(res, (await svc.listCancellations(getCtx(req), { ...query<{ page: number }>(req), page: 1, pageSize: 1 })).summary),
);

// Dues & collection follow-ups
postSalesRouter.get('/dues', authorize('collections.read'), validate({ query: duesQuerySchema }), async (req, res) => {
  const { items, meta } = await svc.listDues(getCtx(req), query(req));
  ok(res, items, meta);
});
postSalesRouter.get('/dues/summary', authorize('collections.read'), validate({ query: duesQuerySchema }), async (req, res) =>
  ok(res, (await svc.listDues(getCtx(req), { ...query<{ page: number; bucket: string }>(req), page: 1, pageSize: 1 })).summary),
);
postSalesRouter.get(
  '/follow-ups',
  authorize('collections.read'),
  validate({ query: z.object({ bookingId: objectId }) }),
  async (req, res) => ok(res, await svc.listFollowUps(getCtx(req), query<{ bookingId: string }>(req).bookingId)),
);
postSalesRouter.post('/follow-ups', authorize('collections.create'), validate({ body: followUpSchema }), async (req, res) =>
  created(res, await svc.createFollowUp(getCtx(req), body(req))),
);

// Agreements, sale-deed registry, possession and demand letters
postSalesRouter.get('/documents', authorize('postSales.read'), validate({ query: salesDocListQuerySchema }), async (req, res) => {
  const { items, meta } = await svc.listSalesDocuments(getCtx(req), query(req));
  ok(res, items, meta);
});
postSalesRouter.get('/documents/summary', authorize('postSales.read'), validate({ query: salesDocListQuerySchema }), async (req, res) =>
  ok(res, (await svc.listSalesDocuments(getCtx(req), { ...query<{ page: number; kind: 'demand' }>(req), page: 1, pageSize: 1 })).summary),
);
postSalesRouter.post('/documents', authorize('postSales.create'), validate({ body: salesDocCreateSchema }), async (req, res) =>
  created(res, await svc.createSalesDocument(getCtx(req), body(req))),
);
postSalesRouter.post('/documents/demand/bulk', authorize('postSales.create'), validate({ body: demandBulkSchema }), async (req, res) =>
  ok(res, await svc.bulkDemand(getCtx(req), body(req))),
);
postSalesRouter.get('/documents/:id', authorize('postSales.read'), validate({ params: idParam }), async (req, res) =>
  ok(res, await svc.getSalesDocument(getCtx(req), params<Id>(req).id)),
);
postSalesRouter.patch(
  '/documents/:id',
  authorize('postSales.update'),
  validate({ params: idParam, body: salesDocUpdateSchema }),
  async (req, res) => ok(res, await svc.updateSalesDocument(getCtx(req), params<Id>(req).id, body(req))),
);
postSalesRouter.get('/documents/:id/pdf', authorize('postSales.read'), validate({ params: idParam }), async (req, res) => {
  await svc.salesDocumentPdf(getCtx(req), params<Id>(req).id, res);
});
