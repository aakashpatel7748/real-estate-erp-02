import { Router, type Request } from 'express';
import type { Model, PopulateOptions, Types } from 'mongoose';
import type { z } from 'zod';
import { idParam, masterListQuerySchema, type Permission } from '@erp/shared';
import { authorize } from '../../middleware/auth';
import { body, params, query, validate } from '../../middleware/validate';
import { audit } from '../../utils/audit';
import { badRequest, notFound } from '../../utils/errors';
import { created, escapeRegex, ok, pageMeta, parseSort } from '../../utils/http';
import { assertProjectAccess, getCtx, toObjectId, type TenantContext } from '../../utils/tenant';

type Doc = Record<string, unknown> & { _id: Types.ObjectId };
type MasterQuery = z.infer<typeof masterListQuerySchema>;

export interface CrudOptions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: Model<any>;
  /** Human label used in errors, e.g. "Financer". */
  entity: string;
  /** Audit entity type and action prefix, e.g. "financer". */
  auditType: string;
  createSchema: z.ZodType;
  updateSchema: z.ZodType;
  permissions: { read: Permission; create: Permission; update: Permission; delete: Permission };
  searchFields: string[];
  sortFields: string[];
  defaultSort: Record<string, 1 | -1>;
  /** Field holding a project reference used for visibility: one id, an id array, or none (company-wide). */
  projectField?: { name: string; many?: boolean; allowNull?: boolean };
  /** Populates; `match: { companyId }` is added automatically. */
  populate?: PopulateOptions[];
  /** Validates references and normalises the input before saving. Return the fields to persist. */
  prepare?: (ctx: TenantContext, input: Record<string, unknown>, existing?: Doc) => Promise<Record<string, unknown>>;
  beforeDelete?: (ctx: TenantContext, doc: Doc) => Promise<void>;
  /** Adds computed values (balances, counts) to listed rows. */
  enrich?: (ctx: TenantContext, rows: Doc[]) => Promise<Doc[]>;
  detail?: (ctx: TenantContext, doc: Doc) => Promise<Record<string, unknown>>;
  /** Extra filters from the list query (kind, type, active...). */
  filter?: (q: MasterQuery) => Record<string, unknown>;
  /** Extra routes, registered before `/:id`. */
  extend?: (router: Router) => void;
}

/** Visibility filter: company + not deleted + (for restricted users) their projects. */
export function masterVisibility(ctx: TenantContext, opts: Pick<CrudOptions, 'projectField'>): Record<string, unknown> {
  const f: Record<string, unknown> = { companyId: ctx.companyId, deletedAt: null };
  const pf = opts.projectField;
  if (pf && ctx.projectScope !== null) {
    const inScope = { $in: ctx.projectScope };
    if (pf.many) f.$or = [{ [pf.name]: { $size: 0 } }, { [pf.name]: inScope }];
    else if (pf.allowNull) f.$or = [{ [pf.name]: null }, { [pf.name]: inScope }];
    else f[pf.name] = inScope;
  }
  return f;
}

/** Throws 400 unless every id belongs to the company (and, for projects, is accessible). */
export async function assertRefs(
  ctx: TenantContext,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: Model<any>,
  ids: (string | undefined | null)[] | undefined,
  label: string,
  opts: { project?: boolean } = {},
): Promise<Types.ObjectId[]> {
  const list = [...new Set((ids ?? []).filter((x): x is string => !!x))];
  if (!list.length) return [];
  if (opts.project) list.forEach((id) => assertProjectAccess(ctx, id));
  const oids = list.map(toObjectId);
  const n = await model.countDocuments({ companyId: ctx.companyId, _id: { $in: oids } });
  if (n !== oids.length) throw badRequest(`${label} not found`);
  return oids;
}

function withMatch(ctx: TenantContext, populate: PopulateOptions[] = []): PopulateOptions[] {
  return populate.map((p) => ({ ...p, match: { ...(p.match as object), companyId: ctx.companyId } }));
}

/** Builds list / get / create / update / delete routes for a tenant-owned master collection. */
export function crudRouter(opts: CrudOptions): Router {
  const router = Router();
  const { model, permissions: perm } = opts;

  async function load(ctx: TenantContext, id: string) {
    const doc = await model.findOne({ ...masterVisibility(ctx, opts), _id: toObjectId(id) });
    if (!doc) throw notFound(opts.entity);
    return doc;
  }

  opts.extend?.(router);

  router.get('/', authorize(perm.read), validate({ query: masterListQuerySchema }), async (req: Request, res) => {
    const ctx = getCtx(req);
    const q = query<MasterQuery>(req);
    const filter: Record<string, unknown> = { ...masterVisibility(ctx, opts), ...(opts.filter?.(q) ?? {}) };
    if (q.active) filter.isActive = q.active === 'true';
    if (q.projectId && opts.projectField) {
      assertProjectAccess(ctx, q.projectId);
      const pid = toObjectId(q.projectId);
      const cond = opts.projectField.allowNull ? { $in: [pid, null] } : pid;
      filter.$and = [...((filter.$and as unknown[]) ?? []), { [opts.projectField.name]: cond }];
    }
    if (q.q) {
      const rx = new RegExp(escapeRegex(q.q), 'i');
      filter.$and = [...((filter.$and as unknown[]) ?? []), { $or: opts.searchFields.map((f) => ({ [f]: rx })) }];
    }
    const sort = parseSort(q.sort, opts.sortFields, opts.defaultSort);
    const [rows, total] = await Promise.all([
      model
        .find(filter)
        .sort(sort)
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize)
        .populate(withMatch(ctx, opts.populate))
        .lean<Doc[]>(),
      model.countDocuments(filter),
    ]);
    ok(res, opts.enrich ? await opts.enrich(ctx, rows) : rows, pageMeta(q.page, q.pageSize, total));
  });

  router.get('/:id', authorize(perm.read), validate({ params: idParam }), async (req, res) => {
    const ctx = getCtx(req);
    const doc = await model
      .findOne({ ...masterVisibility(ctx, opts), _id: toObjectId(params<{ id: string }>(req).id) })
      .populate(withMatch(ctx, opts.populate))
      .lean<Doc>();
    if (!doc) throw notFound(opts.entity);
    ok(res, opts.detail ? await opts.detail(ctx, doc) : doc);
  });

  router.post('/', authorize(perm.create), validate({ body: opts.createSchema }), async (req, res) => {
    const ctx = getCtx(req);
    const input = body<Record<string, unknown>>(req);
    const data = opts.prepare ? await opts.prepare(ctx, input) : input;
    const doc = await model.create({ ...data, companyId: ctx.companyId, createdBy: ctx.userId });
    await audit(ctx, {
      action: `${opts.auditType}.create`,
      entityType: opts.auditType,
      entityId: doc._id,
      summary: String(doc.name ?? doc.code ?? ''),
    });
    created(res, doc.toJSON());
  });

  router.patch('/:id', authorize(perm.update), validate({ params: idParam, body: opts.updateSchema }), async (req, res) => {
    const ctx = getCtx(req);
    const doc = await load(ctx, params<{ id: string }>(req).id);
    const input = body<Record<string, unknown>>(req);
    const data = opts.prepare ? await opts.prepare(ctx, input, doc.toObject() as Doc) : input;
    doc.set(data);
    await doc.save();
    await audit(ctx, { action: `${opts.auditType}.update`, entityType: opts.auditType, entityId: doc._id, changes: input });
    ok(res, doc.toJSON());
  });

  router.delete('/:id', authorize(perm.delete), validate({ params: idParam }), async (req, res) => {
    const ctx = getCtx(req);
    const doc = await load(ctx, params<{ id: string }>(req).id);
    await opts.beforeDelete?.(ctx, doc.toObject() as Doc);
    if ('deletedAt' in model.schema.paths)
      await model.updateOne({ companyId: ctx.companyId, _id: doc._id }, { $set: { deletedAt: new Date() } });
    else await model.deleteOne({ companyId: ctx.companyId, _id: doc._id });
    await audit(ctx, { action: `${opts.auditType}.delete`, entityType: opts.auditType, entityId: doc._id });
    ok(res, { deleted: true });
  });

  return router;
}
