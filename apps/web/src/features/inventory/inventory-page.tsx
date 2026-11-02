import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Download, Layers, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { PLOT_CATEGORIES, PLOT_STATUSES, UNIT_TYPES } from '@erp/shared';
import { api, download, errorMessage } from '@/lib/api';
import { areaToSqft, formatINR, titleCase } from '@/lib/format';
import { useListParams } from '@/hooks/use-list-params';
import { useProjectContext } from '@/hooks/use-project';
import { Can } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Card, Input, Select } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/overlays';
import { DataTable, type Column } from '@/components/data-table';
import { Field, PageHeader, PLOT_STATUS_META, StatusBadge } from '@/components/common';
import { EmptyState } from '@/components/states';
import { SearchInput } from '@/components/search-input';
import { areaField, MoneyInput, percentField, rupeeField, toAreaX100, toBp, toPaise } from '@/components/money';
import type { Project } from '@/features/projects/projects-pages';
import { PlotDrawer, PlotFormSheet, type Plot } from './plot-drawer';

/** Requires a selected project; offers a picker when none is chosen. */
export function useRequiredProject() {
  const ctx = useProjectContext();
  const [params] = useSearchParams();
  const fromUrl = params.get('project');
  React.useEffect(() => {
    if (fromUrl && fromUrl !== ctx.projectId && ctx.projects.some((p) => p.id === fromUrl)) ctx.setProjectId(fromUrl);
  }, [fromUrl, ctx]);
  return ctx;
}

export function ProjectPicker({ title }: { title: string }) {
  const { projects, setProjectId, loading } = useProjectContext();
  return (
    <>
      <PageHeader title={title} />
      <Card>
        {loading ? null : projects.length === 0 ? (
          <EmptyState
            title="No projects yet"
            description="Create a project first."
            action={
              <Button asChild>
                <Link to="/administration/projects">Go to projects</Link>
              </Button>
            }
          />
        ) : (
          <div className="p-6">
            <p className="mb-3 text-sm text-muted-foreground">Choose a project to continue. You can switch any time from the top bar.</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setProjectId(p.id)}
                  className="rounded-lg border p-4 text-left hover:border-primary hover:bg-accent cursor-pointer"
                >
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.code}</p>
                </button>
              ))}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}

const bulkForm = z.object({
  blockId: z.string().optional(),
  prefix: z
    .string()
    .max(10)
    .regex(/^[A-Za-z0-9-/]*$/, 'Letters, digits, - and /'),
  startNumber: z.string().regex(/^\d{1,5}$/, 'Whole number'),
  count: z
    .string()
    .regex(/^\d{1,3}$/, '1–500')
    .refine((v) => Number(v) >= 1 && Number(v) <= 500, '1–500'),
  category: z.enum(PLOT_CATEGORIES),
  unitType: z.enum(UNIT_TYPES),
  floor: z
    .string()
    .regex(/^(-?\d{1,3})?$/, 'Floor number')
    .optional(),
  configuration: z.string().max(40).optional(),
  area: areaField('Area'),
  rate: rupeeField('Rate'),
  plc: percentField('PLC'),
});

function BulkCreateDialog({ open, onOpenChange, project }: { open: boolean; onOpenChange: (o: boolean) => void; project: Project }) {
  const qc = useQueryClient();
  const form = useForm<z.infer<typeof bulkForm>>({
    resolver: zodResolver(bulkForm),
    defaultValues: {
      prefix: '',
      startNumber: '1',
      count: '10',
      category: 'residential',
      unitType: 'plot',
      floor: '',
      configuration: '',
      area: '1200',
      rate: project.defaultRatePaisePerSqft ? String(project.defaultRatePaisePerSqft / 100) : '',
      plc: '',
    },
  });
  const save = useMutation({
    mutationFn: (v: z.infer<typeof bulkForm>) =>
      api.post<{ created: number }>(`/projects/${project.id}/plots/bulk`, {
        blockId: v.blockId || undefined,
        prefix: v.prefix.toUpperCase(),
        startNumber: Number(v.startNumber),
        count: Number(v.count),
        category: v.category,
        unitType: v.unitType,
        floor: v.floor ? Number(v.floor) : undefined,
        configuration: v.configuration || undefined,
        areaX100: toAreaX100(v.area),
        ratePaisePerSqft: toPaise(v.rate),
        plcBp: toBp(v.plc),
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['plots', project.id] });
      qc.invalidateQueries({ queryKey: ['map', project.id] });
      toast.success(`${r.created} units created`);
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const e = form.formState.errors;
  const v = form.watch();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Add units in bulk"
        description="Creates a numbered series (plots, flats, shops…) with identical size and rate. Edit individual units afterwards."
        className="max-w-xl"
      >
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit((x) => save.mutate(x))} noValidate>
          <Field label="Unit type" htmlFor="b-type">
            <Select {...form.register('unitType')}>
              {UNIT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {titleCase(t)}
                </option>
              ))}
            </Select>
          </Field>
          {v.unitType !== 'plot' && v.unitType !== 'farm_house' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Floor" htmlFor="b-floor" error={e.floor?.message}>
                <Input inputMode="numeric" {...form.register('floor')} />
              </Field>
              <Field label="Configuration" htmlFor="b-config">
                <Input placeholder="2 BHK" {...form.register('configuration')} />
              </Field>
            </div>
          )}
          <Field label="Tower / block" htmlFor="b-block">
            <Select {...form.register('blockId')}>
              <option value="">No tower / block</option>
              {project.blocks?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Category" htmlFor="b-cat">
            <Select {...form.register('category')}>
              {PLOT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {titleCase(c)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Number prefix" htmlFor="b-prefix" error={e.prefix?.message} hint="Optional, e.g. A-">
            <Input {...form.register('prefix')} className="uppercase" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start no." htmlFor="b-start" error={e.startNumber?.message}>
              <Input inputMode="numeric" {...form.register('startNumber')} />
            </Field>
            <Field label="Count" htmlFor="b-count" error={e.count?.message}>
              <Input inputMode="numeric" {...form.register('count')} />
            </Field>
          </div>
          <Field label="Area (sq ft)" htmlFor="b-area" error={e.area?.message}>
            <Input inputMode="decimal" {...form.register('area')} />
          </Field>
          <Field label="Rate (₹ / sq ft)" htmlFor="b-rate" error={e.rate?.message}>
            <MoneyInput {...form.register('rate')} />
          </Field>
          <Field label="PLC (%)" htmlFor="b-plc" error={e.plc?.message}>
            <Input inputMode="decimal" {...form.register('plc')} />
          </Field>
          <p className="self-end text-sm text-muted-foreground">
            Creates {v.prefix?.toUpperCase()}
            {v.startNumber} … {v.prefix?.toUpperCase()}
            {Number(v.startNumber || 0) + Number(v.count || 0) - 1}
          </p>
          <DialogFooter className="sm:col-span-2">
            <Button type="submit" loading={save.isPending}>
              Create plots
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function InventoryPage() {
  const { projectId, project: summary } = useRequiredProject();
  const lp = useListParams({ pageSize: 50, sort: 'plotNumber' });
  const [params, setParams] = useSearchParams();
  const openPlot = params.get('plot');
  const [adding, setAdding] = React.useState(false);
  const [bulk, setBulk] = React.useState(false);

  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get<Project>(`/projects/${projectId}`),
    enabled: Boolean(projectId),
  });
  const filters = {
    status: lp.filter('status'),
    blockId: lp.filter('blockId'),
    category: lp.filter('category'),
    unitType: lp.filter('unitType'),
  };
  const plots = useQuery({
    queryKey: ['plots', projectId, lp.query, filters],
    queryFn: () => api.page<Plot>(`/projects/${projectId}/plots`, { ...lp.query, ...filters }),
    enabled: Boolean(projectId),
    placeholderData: (prev) => prev,
  });

  if (!projectId) return <ProjectPicker title="Units / Inventory" />;
  const blocks = project.data?.blocks ?? [];
  const phases = project.data?.phases ?? [];

  const columns: Column<Plot>[] = [
    {
      key: 'plot',
      header: 'Plot',
      sortKey: 'plotNumber',
      cell: (p) => (
        <span className="font-medium">
          {p.blockCode ? <span className="text-muted-foreground">{p.blockCode}-</span> : null}
          {p.plotNumber}
          {p.isCorner && <span className="ml-1.5 text-xs text-muted-foreground">corner</span>}
        </span>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      cell: (p) => (
        <span>
          {titleCase(p.unitType ?? 'plot')}
          {(p.configuration || p.floor !== undefined) && (
            <span className="block text-xs text-muted-foreground">
              {[p.configuration, p.floor !== undefined && p.floor !== null ? `Floor ${p.floor}` : null].filter(Boolean).join(' · ')}
            </span>
          )}
        </span>
      ),
    },
    { key: 'category', header: 'Category', cell: (p) => titleCase(p.category), hideOnMobile: true },
    { key: 'facing', header: 'Facing', cell: (p) => (p.facing ? titleCase(p.facing) : '—'), hideOnMobile: true },
    { key: 'area', header: 'Area (sq ft)', sortKey: 'areaX100', align: 'right', cell: (p) => areaToSqft(p.areaX100) },
    {
      key: 'rate',
      header: 'Rate',
      sortKey: 'ratePaisePerSqft',
      align: 'right',
      cell: (p) => formatINR(p.ratePaisePerSqft, { decimals: false }),
      hideOnMobile: true,
    },
    { key: 'plc', header: 'PLC', align: 'right', cell: (p) => (p.plcBp ? `${p.plcBp / 100}%` : '—'), hideOnMobile: true },
    {
      key: 'price',
      header: 'List price',
      sortKey: 'listPricePaise',
      align: 'right',
      cell: (p) => formatINR(p.listPricePaise, { decimals: false }),
    },
    { key: 'status', header: 'Status', sortKey: 'status', cell: (p) => <StatusBadge status={p.status} kind="plot" /> },
  ];

  const setPlot = (id: string | null) =>
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (id) n.set('plot', id);
        else n.delete('plot');
        return n;
      },
      { replace: true },
    );

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: 'Projects', to: '/administration/projects' },
          { label: summary?.name ?? 'Project', to: `/administration/projects/${projectId}` },
          { label: 'Inventory' },
        ]}
        title="Units / Inventory"
        description={summary?.name}
        actions={
          <>
            <Can permission="reports.export">
              <Button
                variant="outline"
                onClick={() => void download(`/projects/${projectId}/plots.xlsx`).catch((e) => toast.error(errorMessage(e)))}
              >
                <Download /> Excel
              </Button>
            </Can>
            <Can permission="inventory.create">
              <Button variant="outline" onClick={() => setBulk(true)} disabled={!project.data}>
                <Layers /> Bulk add
              </Button>
              <Button onClick={() => setAdding(true)}>
                <Plus /> Add plot
              </Button>
            </Can>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {PLOT_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => lp.setFilter('status', filters.status === s ? undefined : s)}
            aria-pressed={filters.status === s}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${filters.status === s ? 'border-primary bg-accent' : 'bg-card hover:bg-muted'}`}
          >
            <span className="size-2 rounded-full" style={{ background: PLOT_STATUS_META[s].color }} aria-hidden />
            {PLOT_STATUS_META[s].label}
          </button>
        ))}
      </div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <SearchInput value={lp.q} onChange={lp.setQ} placeholder="Search plot number" />
        <Select
          className="sm:w-44"
          value={filters.blockId ?? ''}
          onChange={(e) => lp.setFilter('blockId', e.target.value || undefined)}
          aria-label="Block filter"
        >
          <option value="">All blocks</option>
          {blocks.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
        <Select
          className="sm:w-44"
          value={filters.category ?? ''}
          onChange={(e) => lp.setFilter('category', e.target.value || undefined)}
          aria-label="Category filter"
        >
          <option value="">All categories</option>
          {PLOT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {titleCase(c)}
            </option>
          ))}
        </Select>
        <Select
          className="sm:w-40"
          value={filters.unitType ?? ''}
          onChange={(e) => lp.setFilter('unitType', e.target.value || undefined)}
          aria-label="Unit type filter"
        >
          <option value="">All unit types</option>
          {UNIT_TYPES.map((t) => (
            <option key={t} value={t}>
              {titleCase(t)}
            </option>
          ))}
        </Select>
      </div>

      <DataTable
        columns={columns}
        rows={plots.data?.items}
        rowKey={(p) => p.id}
        loading={plots.isPending}
        error={plots.error}
        onRetry={() => plots.refetch()}
        meta={plots.data?.meta}
        onPageChange={lp.setPage}
        pageSize={lp.pageSize}
        onPageSizeChange={lp.setPageSize}
        sort={lp.sort}
        onSortChange={lp.setSort}
        onRowClick={(p) => setPlot(p.id)}
        empty={<EmptyState title="No plots match" description="Add plots one by one or in bulk, or clear the filters." />}
      />

      <PlotDrawer projectId={projectId} plotId={openPlot} onClose={() => setPlot(null)} blocks={blocks} phases={phases} />
      <PlotFormSheet open={adding} onOpenChange={setAdding} projectId={projectId} blocks={blocks} phases={phases} />
      {project.data && <BulkCreateDialog open={bulk} onOpenChange={setBulk} project={project.data} />}
    </>
  );
}
