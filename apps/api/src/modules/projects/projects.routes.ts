import { Router } from 'express';
import { z } from 'zod';
import {
  blockSchema,
  bulkPlotSchema,
  listQuerySchema,
  mapConfigSchema,
  mapShapesBulkSchema,
  objectId,
  phaseSchema,
  plotListQuerySchema,
  plotSchema,
  plotStatusChangeSchema,
  plotUpdateSchema,
  projectSchema,
  projectUpdateSchema,
  PROJECT_STATUSES,
  type BlockInput,
  type BulkPlotInput,
  type MapConfig,
  type PhaseInput,
  type PlotInput,
  type PlotStatus,
  type ProjectInput,
  patchSchema,
} from '@erp/shared';
import { authorize } from '../../middleware/auth';
import { body, params, query, validate } from '../../middleware/validate';
import { created, ok } from '../../utils/http';
import { getCtx } from '../../utils/tenant';
import * as plots from '../plots/plots.service';
import { exportPlots } from '../reports/documents.service';
import * as projects from './projects.service';

export const projectsRouter = Router();

const pid = z.object({ id: objectId });
const pidPhase = z.object({ id: objectId, phaseId: objectId });
const pidBlock = z.object({ id: objectId, blockId: objectId });
const pidPlot = z.object({ id: objectId, plotId: objectId });
type P = { id: string; phaseId: string; blockId: string; plotId: string };

const projectListQuery = listQuerySchema.extend({
  status: z.enum(PROJECT_STATUSES).optional(),
  includeArchived: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

projectsRouter.get('/', authorize('projects.read'), validate({ query: projectListQuery }), async (req, res) => {
  const { items, meta } = await projects.listProjects(getCtx(req), query(req));
  ok(res, items, meta);
});
projectsRouter.post('/', authorize('projects.create'), validate({ body: projectSchema }), async (req, res) =>
  created(res, await projects.createProject(getCtx(req), body<ProjectInput>(req))),
);
projectsRouter.get('/:id', authorize('projects.read'), validate({ params: pid }), async (req, res) =>
  ok(res, await projects.getProject(getCtx(req), params<P>(req).id)),
);
projectsRouter.patch('/:id', authorize('projects.update'), validate({ params: pid, body: projectUpdateSchema }), async (req, res) =>
  ok(res, await projects.updateProject(getCtx(req), params<P>(req).id, body<Partial<ProjectInput>>(req))),
);
projectsRouter.post('/:id/archive', authorize('projects.archive'), validate({ params: pid }), async (req, res) =>
  ok(res, await projects.archiveProject(getCtx(req), params<P>(req).id)),
);

// Phases & blocks
projectsRouter.post('/:id/phases', authorize('projects.update'), validate({ params: pid, body: phaseSchema }), async (req, res) =>
  created(res, await projects.createPhase(getCtx(req), params<P>(req).id, body<PhaseInput>(req))),
);
projectsRouter.patch(
  '/:id/phases/:phaseId',
  authorize('projects.update'),
  validate({ params: pidPhase, body: patchSchema(phaseSchema) }),
  async (req, res) => {
    const p = params<P>(req);
    ok(res, await projects.updatePhase(getCtx(req), p.id, p.phaseId, body<Partial<PhaseInput>>(req)));
  },
);
projectsRouter.delete('/:id/phases/:phaseId', authorize('projects.update'), validate({ params: pidPhase }), async (req, res) => {
  const p = params<P>(req);
  await projects.deletePhase(getCtx(req), p.id, p.phaseId);
  ok(res, { deleted: true });
});
projectsRouter.post('/:id/blocks', authorize('projects.update'), validate({ params: pid, body: blockSchema }), async (req, res) =>
  created(res, await projects.createBlock(getCtx(req), params<P>(req).id, body<BlockInput>(req))),
);
projectsRouter.patch(
  '/:id/blocks/:blockId',
  authorize('projects.update'),
  validate({ params: pidBlock, body: patchSchema(blockSchema) }),
  async (req, res) => {
    const p = params<P>(req);
    ok(res, await projects.updateBlock(getCtx(req), p.id, p.blockId, body<Partial<BlockInput>>(req)));
  },
);
projectsRouter.delete('/:id/blocks/:blockId', authorize('projects.update'), validate({ params: pidBlock }), async (req, res) => {
  const p = params<P>(req);
  await projects.deleteBlock(getCtx(req), p.id, p.blockId);
  ok(res, { deleted: true });
});

// Plot inventory
projectsRouter.get('/:id/plots', authorize('inventory.read'), validate({ params: pid, query: plotListQuerySchema }), async (req, res) => {
  const { items, meta } = await plots.listPlots(getCtx(req), params<P>(req).id, query(req));
  ok(res, items, meta);
});
projectsRouter.get('/:id/plots.xlsx', authorize('inventory.read', 'reports.export'), validate({ params: pid }), async (req, res) => {
  await exportPlots(getCtx(req), params<P>(req).id, res);
});
projectsRouter.post('/:id/plots', authorize('inventory.create'), validate({ params: pid, body: plotSchema }), async (req, res) =>
  created(res, await plots.createPlot(getCtx(req), params<P>(req).id, body<PlotInput>(req))),
);
projectsRouter.post('/:id/plots/bulk', authorize('inventory.create'), validate({ params: pid, body: bulkPlotSchema }), async (req, res) =>
  created(res, await plots.bulkCreatePlots(getCtx(req), params<P>(req).id, body<BulkPlotInput>(req))),
);
projectsRouter.get('/:id/plots/:plotId', authorize('inventory.read'), validate({ params: pidPlot }), async (req, res) => {
  const p = params<P>(req);
  ok(res, await plots.getPlot(getCtx(req), p.id, p.plotId));
});
projectsRouter.patch(
  '/:id/plots/:plotId',
  authorize('inventory.update'),
  validate({ params: pidPlot, body: plotUpdateSchema }),
  async (req, res) => {
    const p = params<P>(req);
    ok(res, await plots.updatePlot(getCtx(req), p.id, p.plotId, body<Partial<PlotInput>>(req)));
  },
);
projectsRouter.post(
  '/:id/plots/:plotId/status',
  authorize('inventory.status'),
  validate({ params: pidPlot, body: plotStatusChangeSchema }),
  async (req, res) => {
    const p = params<P>(req);
    const b = body<{ status: PlotStatus; reason: string }>(req);
    ok(res, await plots.changePlotStatus(getCtx(req), p.id, p.plotId, b.status, b.reason));
  },
);
projectsRouter.delete('/:id/plots/:plotId', authorize('inventory.delete'), validate({ params: pidPlot }), async (req, res) => {
  const p = params<P>(req);
  await plots.deletePlot(getCtx(req), p.id, p.plotId);
  ok(res, { deleted: true });
});

// Interactive map
projectsRouter.get('/:id/map', authorize('map.read'), validate({ params: pid }), async (req, res) =>
  ok(res, await plots.getMapData(getCtx(req), params<P>(req).id)),
);
projectsRouter.put('/:id/map', authorize('map.edit'), validate({ params: pid, body: mapConfigSchema }), async (req, res) =>
  ok(res, await projects.updateMapConfig(getCtx(req), params<P>(req).id, body<MapConfig>(req))),
);
projectsRouter.put('/:id/map/shapes', authorize('map.edit'), validate({ params: pid, body: mapShapesBulkSchema }), async (req, res) =>
  ok(
    res,
    await plots.saveMapShapes(getCtx(req), params<P>(req).id, body<{ shapes: { plotId: string; points: string | null }[] }>(req).shapes),
  ),
);
