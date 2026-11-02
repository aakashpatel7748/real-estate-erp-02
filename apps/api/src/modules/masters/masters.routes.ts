import { Router } from 'express';
import { z } from 'zod';
import {
  chargeMasterBaseSchema,
  chargeMasterSchema,
  consultantSchema,
  financerSchema,
  idParam,
  objectId,
  parkingAllotSchema,
  parkingBulkSchema,
  parkingListQuerySchema,
  parkingSlotSchema,
  partySchema,
  rateIndexSchema,
  requiredText,
  type ChargeMasterInput,
  patchSchema,
} from '@erp/shared';
import { authorize } from '../../middleware/auth';
import { body, params, query, validate } from '../../middleware/validate';
import { businessRule } from '../../utils/errors';
import { created, ok } from '../../utils/http';
import { getCtx, toObjectId } from '../../utils/tenant';
import { Booking } from '../bookings/booking.models';
import { LandParcel } from '../land/land.model';
import { Block, Project, ProjectPhase } from '../projects/project.models';
import { assertRefs, crudRouter } from './crud';
import { ChargeMaster, Consultant, Financer, Party, RateIndex } from './masters.models';
import * as svc from './masters.service';

type Id = { id: string };
const projectPop = { path: 'projectId', select: 'name code' };

// ---------- Land owners & partners ----------
export const partiesRouter = crudRouter({
  model: Party,
  entity: 'Party',
  auditType: 'party',
  createSchema: partySchema,
  updateSchema: patchSchema(partySchema),
  permissions: { read: 'masters.read', create: 'masters.create', update: 'masters.update', delete: 'masters.delete' },
  searchFields: ['name', 'phone', 'pan', 'email'],
  sortFields: ['name', 'kind', 'createdAt'],
  defaultSort: { name: 1 },
  populate: [
    { path: 'landParcelIds', select: 'khasraNumber village status' },
    { path: 'projectIds', select: 'name code' },
  ],
  filter: (q) => (q.kind ? { kind: q.kind } : {}),
  prepare: async (ctx, input) => {
    if (input.landParcelIds) input.landParcelIds = await assertRefs(ctx, LandParcel, input.landParcelIds as string[], 'Land parcel');
    if (input.projectIds) input.projectIds = await assertRefs(ctx, Project, input.projectIds as string[], 'Project', { project: true });
    return input;
  },
});

// ---------- Banks & home-loan financers ----------
export const financersRouter = crudRouter({
  model: Financer,
  entity: 'Financer',
  auditType: 'financer',
  createSchema: financerSchema,
  updateSchema: patchSchema(financerSchema),
  permissions: { read: 'masters.read', create: 'masters.create', update: 'masters.update', delete: 'masters.delete' },
  searchFields: ['name', 'branch', 'contactPerson', 'phone'],
  sortFields: ['name', 'type', 'createdAt'],
  defaultSort: { name: 1 },
  populate: [{ path: 'approvedProjectIds', select: 'name code' }],
  filter: (q) => (q.type ? { type: q.type } : {}),
  prepare: async (ctx, input) => {
    if (input.approvedProjectIds)
      input.approvedProjectIds = await assertRefs(ctx, Project, input.approvedProjectIds as string[], 'Project');
    return input;
  },
  enrich: svc.enrichFinancers,
  detail: svc.financerDetail,
  beforeDelete: async (ctx, doc) => {
    if (await Booking.exists({ companyId: ctx.companyId, 'loan.financerId': doc._id })) {
      throw businessRule('This lender is linked to bookings; mark it inactive instead');
    }
  },
});

// ---------- Registry & legal consultants ----------
export const consultantsRouter = crudRouter({
  model: Consultant,
  entity: 'Consultant',
  auditType: 'consultant',
  createSchema: consultantSchema,
  updateSchema: patchSchema(consultantSchema),
  permissions: { read: 'masters.read', create: 'masters.create', update: 'masters.update', delete: 'masters.delete' },
  searchFields: ['name', 'firm', 'phone', 'registrationNo'],
  sortFields: ['name', 'type', 'createdAt'],
  defaultSort: { name: 1 },
  filter: (q) => (q.type ? { type: q.type } : {}),
});

// ---------- Other charges (PLC, club, maintenance...) ----------
export const chargesRouter = crudRouter({
  model: ChargeMaster,
  entity: 'Charge',
  auditType: 'charge',
  createSchema: chargeMasterSchema,
  updateSchema: patchSchema(chargeMasterBaseSchema),
  permissions: { read: 'masters.read', create: 'masters.create', update: 'masters.update', delete: 'masters.delete' },
  searchFields: ['name'],
  sortFields: ['name', 'kind', 'createdAt'],
  defaultSort: { kind: 1, name: 1 },
  projectField: { name: 'projectId', allowNull: true },
  populate: [projectPop],
  filter: (q) => (q.kind ? { kind: q.kind } : {}),
  prepare: async (ctx, input) => {
    const i = input as Partial<ChargeMasterInput>;
    if (i.projectId) await assertRefs(ctx, Project, [i.projectId], 'Project', { project: true });
    else if ('projectId' in input && ctx.projectScope !== null) throw businessRule('Choose one of your projects');
    if (i.basis === 'percent' && (i.value ?? 0) > 10_000) throw businessRule('Percentage cannot exceed 100%');
    return { ...input, projectId: i.projectId ? toObjectId(i.projectId) : null };
  },
  extend: (r) => {
    /** Charges that apply to the given units, priced: used by quotation and booking forms. */
    r.post(
      '/compute',
      authorize('masters.read'),
      validate({ body: z.object({ projectId: z.string(), plotIds: z.array(z.string()).max(20) }) }),
      async (req, res) => {
        const b = body<{ projectId: string; plotIds: string[] }>(req);
        ok(res, await svc.computeCharges(getCtx(req), b.projectId, b.plotIds));
      },
    );
  },
});

// ---------- Rate & price indexes ----------
export const rateIndexesRouter = crudRouter({
  model: RateIndex,
  entity: 'Rate index',
  auditType: 'rate_index',
  createSchema: rateIndexSchema,
  updateSchema: patchSchema(rateIndexSchema),
  permissions: { read: 'inventory.read', create: 'inventory.update', update: 'inventory.update', delete: 'inventory.update' },
  searchFields: ['name', 'notes'],
  sortFields: ['effectiveFrom', 'name', 'ratePaisePerSqft', 'createdAt'],
  defaultSort: { effectiveFrom: -1 },
  projectField: { name: 'projectId' },
  populate: [projectPop, { path: 'phaseId', select: 'name code' }, { path: 'blockId', select: 'name code' }],
  prepare: async (ctx, input, existing) => {
    const projectId = (input.projectId as string | undefined) ?? (existing ? String(existing.projectId) : undefined);
    if (input.projectId) await assertRefs(ctx, Project, [projectId], 'Project', { project: true });
    if (input.phaseId) {
      if (
        !(await ProjectPhase.exists({
          companyId: ctx.companyId,
          projectId: toObjectId(projectId!),
          _id: toObjectId(input.phaseId as string),
        }))
      )
        throw businessRule('Phase does not belong to this project');
    }
    if (input.blockId) {
      if (!(await Block.exists({ companyId: ctx.companyId, projectId: toObjectId(projectId!), _id: toObjectId(input.blockId as string) })))
        throw businessRule('Tower / block does not belong to this project');
    }
    if (input.effectiveFrom) input.effectiveFrom = new Date(`${input.effectiveFrom as string}T00:00:00.000Z`);
    return input;
  },
  extend: (r) => {
    r.post(
      '/:id/apply',
      authorize('inventory.update'),
      validate({ params: idParam, body: z.object({ dryRun: z.boolean().default(false) }) }),
      async (req, res) => ok(res, await svc.applyRateIndex(getCtx(req), params<Id>(req).id, body<{ dryRun: boolean }>(req).dryRun)),
    );
  },
});

// ---------- Parking slots ----------
export const parkingRouter = Router();
parkingRouter.get('/', authorize('inventory.read'), validate({ query: parkingListQuerySchema }), async (req, res) => {
  const { items, meta } = await svc.listParking(getCtx(req), query(req));
  ok(res, items, meta);
});
parkingRouter.get('/summary', authorize('inventory.read'), validate({ query: parkingListQuerySchema }), async (req, res) =>
  ok(res, (await svc.listParking(getCtx(req), { ...query<{ page: number }>(req), page: 1, pageSize: 1 })).summary),
);
parkingRouter.post('/', authorize('inventory.create'), validate({ body: parkingSlotSchema }), async (req, res) =>
  created(res, await svc.createParking(getCtx(req), body(req))),
);
parkingRouter.post('/bulk', authorize('inventory.create'), validate({ body: parkingBulkSchema }), async (req, res) =>
  created(res, await svc.bulkCreateParking(getCtx(req), body(req))),
);
parkingRouter.patch(
  '/:id',
  authorize('inventory.update'),
  validate({ params: idParam, body: patchSchema(parkingSlotSchema.omit({ projectId: true })) }),
  async (req, res) => ok(res, await svc.updateParking(getCtx(req), params<Id>(req).id, body(req))),
);
parkingRouter.post('/:id/allot', authorize('inventory.status'), validate({ params: idParam, body: parkingAllotSchema }), async (req, res) =>
  ok(res, await svc.allotParking(getCtx(req), params<Id>(req).id, body(req))),
);
parkingRouter.post(
  '/:id/release',
  authorize('inventory.status'),
  validate({ params: idParam, body: z.object({ note: requiredText('Reason', 300) }) }),
  async (req, res) => ok(res, await svc.releaseParking(getCtx(req), params<Id>(req).id, body<{ note: string }>(req).note)),
);
parkingRouter.post(
  '/:id/block',
  authorize('inventory.status'),
  validate({ params: idParam, body: z.object({ blocked: z.boolean(), note: requiredText('Reason', 300) }) }),
  async (req, res) => {
    const b = body<{ blocked: boolean; note: string }>(req);
    ok(res, await svc.blockParking(getCtx(req), params<Id>(req).id, b.blocked, b.note));
  },
);
parkingRouter.delete('/:id', authorize('inventory.delete'), validate({ params: idParam }), async (req, res) => {
  await svc.deleteParking(getCtx(req), params<Id>(req).id);
  ok(res, { deleted: true });
});

// ---------- Phases / towers ----------
export const structureRouter = Router();
structureRouter.get('/', authorize('projects.read'), validate({ query: z.object({ projectId: objectId.optional() }) }), async (req, res) =>
  ok(res, await svc.projectStructure(getCtx(req), query<{ projectId?: string }>(req).projectId)),
);
