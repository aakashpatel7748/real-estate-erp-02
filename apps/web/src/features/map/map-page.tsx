import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Eraser, Maximize2, MousePointer2, PenLine, Save, Square, Undo2, ZoomIn, ZoomOut } from 'lucide-react';
import { toast } from 'sonner';
import { PLOT_STATUSES, type PlotStatus } from '@erp/shared';
import { api, errorMessage } from '@/lib/api';
import { areaToSqft, formatINR } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useAuth } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Card, Select, Tooltip } from '@/components/ui/primitives';
import { PageHeader, PLOT_STATUS_META } from '@/components/common';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/states';
import type { Project } from '@/features/projects/projects-pages';
import { PlotDrawer } from '@/features/inventory/plot-drawer';
import { ProjectPicker, useRequiredProject } from '@/features/inventory/inventory-page';

interface MapPlot {
  id: string;
  plotNumber: string;
  status: PlotStatus;
  points: string | null;
  areaX100: number;
  listPricePaise: number;
  facing?: string;
  isCorner: boolean;
  blockId: string | null;
}
interface MapData {
  map: { width: number; height: number; backgroundColor: string };
  summary: Partial<Record<PlotStatus, number>>;
  plots: MapPlot[];
}

type Pt = [number, number];
const parsePoints = (s: string): Pt[] =>
  s
    .trim()
    .split(/\s+/)
    .map((p) => p.split(',').map(Number) as Pt);
const toPoints = (pts: Pt[]) => pts.map(([x, y]) => `${Math.round(x)},${Math.round(y)}`).join(' ');
function centroid(pts: Pt[]): Pt {
  const n = pts.length;
  return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
}

/** Pan/zoom by manipulating the SVG viewBox; works with mouse, wheel and touch-friendly buttons. */
function useViewBox(width: number, height: number) {
  const [vb, setVb] = React.useState({ x: 0, y: 0, w: width, h: height });
  React.useEffect(() => setVb({ x: 0, y: 0, w: width, h: height }), [width, height]);
  const zoom = (factor: number, cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2) => {
    setVb((v) => {
      const w = Math.min(width * 2, Math.max(width / 8, v.w * factor));
      const h = (w / v.w) * v.h;
      return { x: cx - ((cx - v.x) * w) / v.w, y: cy - ((cy - v.y) * h) / v.h, w, h };
    });
  };
  return { vb, setVb, zoom, reset: () => setVb({ x: 0, y: 0, w: width, h: height }) };
}

export function MapPage() {
  const { projectId, project: summary } = useRequiredProject();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [selected, setSelected] = React.useState<string | null>(null);
  const [hover, setHover] = React.useState<{ plot: MapPlot; x: number; y: number } | null>(null);
  const [highlight, setHighlight] = React.useState<PlotStatus | null>(null);
  const [mode, setMode] = React.useState<'view' | 'edit'>('view');
  const [tool, setTool] = React.useState<'polygon' | 'rect' | 'select'>('rect');
  const [editPlot, setEditPlot] = React.useState<string>('');
  const [draft, setDraft] = React.useState<Pt[]>([]);
  const [rectStart, setRectStart] = React.useState<Pt | null>(null);
  const [pending, setPending] = React.useState<Record<string, string | null>>({});
  const svgRef = React.useRef<SVGSVGElement>(null);
  const drag = React.useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  const q = useQuery({
    queryKey: ['map', projectId],
    queryFn: () => api.get<MapData>(`/projects/${projectId}/map`),
    enabled: Boolean(projectId),
    // Near-real-time inventory: refresh while the page is visible.
    refetchInterval: mode === 'view' ? 15_000 : false,
  });
  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get<Project>(`/projects/${projectId}`),
    enabled: Boolean(projectId),
  });
  const width = q.data?.map.width ?? 1200;
  const height = q.data?.map.height ?? 800;
  const view = useViewBox(width, height);

  const saveShapes = useMutation({
    mutationFn: () =>
      api.put(`/projects/${projectId}/map/shapes`, { shapes: Object.entries(pending).map(([plotId, points]) => ({ plotId, points })) }),
    onSuccess: () => {
      setPending({});
      qc.invalidateQueries({ queryKey: ['map', projectId] });
      toast.success('Layout saved');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!projectId) return <ProjectPicker title="Plot map" />;
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  const data = q.data;
  const shapeOf = (p: MapPlot) => (p.id in pending ? pending[p.id] : p.points);
  const mapped = data.plots.filter((p) => shapeOf(p));
  const unmapped = data.plots.filter((p) => !shapeOf(p));
  const blockCode = (id: string | null) => project.data?.blocks?.find((b) => b.id === id)?.code;
  const label = (p: MapPlot) => `${blockCode(p.blockId) ? `${blockCode(p.blockId)}-` : ''}${p.plotNumber}`;

  const toSvg = (e: React.MouseEvent | React.PointerEvent): Pt => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const r = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return [Math.max(0, Math.min(width, r.x)), Math.max(0, Math.min(height, r.y))];
  };

  const commitShape = (pts: Pt[]) => {
    if (!editPlot) return toast.error('Choose the plot you are drawing first');
    if (pts.length < 3) return toast.error('A shape needs at least 3 points');
    setPending((p) => ({ ...p, [editPlot]: toPoints(pts) }));
    setDraft([]);
    // Move on to the next unmapped plot for fast digitising.
    const next = unmapped.find((u) => u.id !== editPlot);
    setEditPlot(next?.id ?? '');
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (mode === 'edit' && tool === 'rect') {
      setRectStart(toSvg(e));
      return;
    }
    if (mode === 'edit' && tool === 'polygon') return;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.vb.x, vy: view.vb.y };
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drag.current && svgRef.current) {
      const scale = view.vb.w / svgRef.current.clientWidth;
      view.setVb((v) => ({
        ...v,
        x: drag.current!.vx - (e.clientX - drag.current!.x) * scale,
        y: drag.current!.vy - (e.clientY - drag.current!.y) * scale,
      }));
    }
    if (rectStart) {
      const [x2, y2] = toSvg(e);
      const [x1, y1] = rectStart;
      setDraft([
        [x1, y1],
        [x2, y1],
        [x2, y2],
        [x1, y2],
      ]);
    }
  };
  const onPointerUp = () => {
    drag.current = null;
    if (rectStart) {
      setRectStart(null);
      const [a, , c] = draft;
      if (a && c && Math.abs(c[0] - a[0]) > 4 && Math.abs(c[1] - a[1]) > 4) commitShape(draft);
      else setDraft([]);
    }
  };
  const onClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (mode === 'edit' && tool === 'polygon') setDraft((d) => [...d, toSvg(e)]);
  };
  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    const [cx, cy] = toSvg(e);
    view.zoom(e.deltaY > 0 ? 1.15 : 0.87, cx, cy);
  };

  const total = Object.values(data.summary).reduce((a, b) => a + (b ?? 0), 0);
  const dirty = Object.keys(pending).length > 0;

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: 'Projects', to: '/administration/projects' },
          { label: summary?.name ?? 'Project', to: `/administration/projects/${projectId}` },
          { label: 'Map' },
        ]}
        title="Plot map"
        description={`${summary?.name ?? ''} · ${total} plots · updates automatically`}
        actions={
          can('map.edit') && (
            <div className="flex gap-2">
              <Button variant={mode === 'view' ? 'default' : 'outline'} onClick={() => setMode('view')}>
                <MousePointer2 /> View
              </Button>
              <Button
                variant={mode === 'edit' ? 'default' : 'outline'}
                onClick={() => {
                  setMode('edit');
                  setEditPlot(unmapped[0]?.id ?? '');
                }}
              >
                <PenLine /> Edit layout
              </Button>
            </div>
          )
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_280px]">
        <Card className="relative overflow-hidden">
          <div className="absolute left-3 top-3 z-10 flex flex-col gap-1 rounded-lg border bg-card/95 p-1 shadow-sm">
            <Tooltip content="Zoom in" side="right">
              <Button variant="ghost" size="icon-sm" onClick={() => view.zoom(0.8)} aria-label="Zoom in">
                <ZoomIn />
              </Button>
            </Tooltip>
            <Tooltip content="Zoom out" side="right">
              <Button variant="ghost" size="icon-sm" onClick={() => view.zoom(1.25)} aria-label="Zoom out">
                <ZoomOut />
              </Button>
            </Tooltip>
            <Tooltip content="Fit" side="right">
              <Button variant="ghost" size="icon-sm" onClick={view.reset} aria-label="Fit to screen">
                <Maximize2 />
              </Button>
            </Tooltip>
          </div>
          {mapped.length === 0 && mode === 'view' ? (
            <EmptyState
              title="This layout has not been drawn yet"
              description={
                can('map.edit')
                  ? 'Switch to “Edit layout” and draw each plot as a rectangle or polygon.'
                  : 'Ask an administrator to draw the plot layout.'
              }
            />
          ) : (
            <svg
              ref={svgRef}
              viewBox={`${view.vb.x} ${view.vb.y} ${view.vb.w} ${view.vb.h}`}
              className={cn(
                'block h-[min(70vh,720px)] w-full touch-none select-none',
                mode === 'edit' && tool !== 'select' ? 'cursor-crosshair' : 'cursor-grab',
              )}
              role="img"
              aria-label={`Layout map of ${summary?.name}`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
              onClick={onClick}
              onWheel={onWheel}
            >
              <rect x={0} y={0} width={width} height={height} fill={data.map.backgroundColor} />
              <defs>
                <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--border)" strokeWidth="0.5" />
                </pattern>
              </defs>
              {mode === 'edit' && <rect x={0} y={0} width={width} height={height} fill="url(#grid)" />}
              {mapped.map((p) => {
                const pts = parsePoints(shapeOf(p)!);
                const [cx, cy] = centroid(pts);
                const meta = PLOT_STATUS_META[p.status];
                const dim = highlight && highlight !== p.status;
                const active = selected === p.id || editPlot === p.id;
                return (
                  <g
                    key={p.id}
                    role="button"
                    tabIndex={mode === 'view' ? 0 : -1}
                    aria-label={`Plot ${label(p)}, ${meta.label}, ${areaToSqft(p.areaX100)} square feet, ${formatINR(p.listPricePaise, { decimals: false })}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (mode === 'view') setSelected(p.id);
                      else if (tool === 'select') setEditPlot(p.id);
                    }}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && mode === 'view' && setSelected(p.id)}
                    onPointerEnter={(e) => setHover({ plot: p, x: e.clientX, y: e.clientY })}
                    onPointerMove={(e) => setHover({ plot: p, x: e.clientX, y: e.clientY })}
                    onPointerLeave={() => setHover(null)}
                    className="cursor-pointer outline-none [&:focus-visible>polygon]:stroke-[3px]"
                  >
                    <polygon
                      points={shapeOf(p)!}
                      fill={meta.color}
                      fillOpacity={dim ? 0.12 : p.id in pending ? 0.45 : 0.75}
                      stroke={active ? 'var(--foreground)' : '#ffffff'}
                      strokeWidth={active ? 3 : 1.5}
                    />
                    <text
                      x={cx}
                      y={cy}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={Math.min(16, Math.max(9, Math.sqrt(p.areaX100) / 30))}
                      fontWeight={600}
                      fill={dim ? '#94a3b8' : '#ffffff'}
                      pointerEvents="none"
                    >
                      {label(p)}
                    </text>
                  </g>
                );
              })}
              {draft.length > 0 && (
                <>
                  <polygon
                    points={toPoints(draft)}
                    fill="var(--primary)"
                    fillOpacity={0.25}
                    stroke="var(--primary)"
                    strokeDasharray="6 4"
                    strokeWidth={2}
                  />
                  {draft.map(([x, y], i) => (
                    <circle key={i} cx={x} cy={y} r={4} fill="var(--primary)" />
                  ))}
                </>
              )}
            </svg>
          )}
          {hover && mode === 'view' && (
            <div
              className="pointer-events-none fixed z-50 rounded-lg border bg-popover px-3 py-2 text-xs shadow-lg"
              style={{ left: hover.x + 14, top: hover.y + 14 }}
            >
              <p className="font-semibold">Plot {label(hover.plot)}</p>
              <p>
                {PLOT_STATUS_META[hover.plot.status].label} · {areaToSqft(hover.plot.areaX100)} sq ft
              </p>
              <p className="tabular">{formatINR(hover.plot.listPricePaise, { decimals: false })}</p>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          {mode === 'view' ? (
            <Card className="p-4">
              <p className="mb-3 text-sm font-semibold">Legend</p>
              <ul className="space-y-1">
                {PLOT_STATUSES.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      aria-pressed={highlight === s}
                      onClick={() => setHighlight(highlight === s ? null : s)}
                      className={cn(
                        'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted cursor-pointer',
                        highlight === s && 'bg-accent',
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span className="size-3 rounded-sm" style={{ background: PLOT_STATUS_META[s].color }} aria-hidden />
                        {PLOT_STATUS_META[s].label}
                      </span>
                      <span className="tabular text-muted-foreground">{data.summary[s] ?? 0}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                Click a status to highlight it. Click a plot for details. Scroll to zoom, drag to pan.
              </p>
              {unmapped.length > 0 && <p className="mt-3 text-xs text-amber-700">{unmapped.length} plots are not drawn on the map yet.</p>}
            </Card>
          ) : (
            <Card className="space-y-4 p-4">
              <div>
                <p className="mb-2 text-sm font-semibold">Drawing tool</p>
                <div className="grid grid-cols-3 gap-1">
                  {(
                    [
                      ['rect', Square, 'Rectangle'],
                      ['polygon', PenLine, 'Polygon'],
                      ['select', MousePointer2, 'Pick'],
                    ] as const
                  ).map(([t, Icon, l]) => (
                    <Button key={t} variant={tool === t ? 'default' : 'outline'} size="sm" onClick={() => setTool(t)}>
                      <Icon /> {l}
                    </Button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {tool === 'rect'
                    ? 'Drag on the map to draw.'
                    : tool === 'polygon'
                      ? 'Click to add corners, then Finish.'
                      : 'Click a drawn plot to select it.'}
                </p>
              </div>
              <div>
                <label htmlFor="edit-plot" className="mb-1.5 block text-sm font-medium">
                  Plot being drawn
                </label>
                <Select id="edit-plot" value={editPlot} onChange={(e) => setEditPlot(e.target.value)}>
                  <option value="">Choose a plot…</option>
                  <optgroup label={`Not drawn (${unmapped.length})`}>
                    {unmapped.map((p) => (
                      <option key={p.id} value={p.id}>
                        {label(p)}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Already drawn (redraw)">
                    {mapped.map((p) => (
                      <option key={p.id} value={p.id}>
                        {label(p)}
                      </option>
                    ))}
                  </optgroup>
                </Select>
              </div>
              <div className="flex flex-wrap gap-2">
                {tool === 'polygon' && (
                  <>
                    <Button size="sm" variant="outline" disabled={!draft.length} onClick={() => setDraft((d) => d.slice(0, -1))}>
                      <Undo2 /> Undo point
                    </Button>
                    <Button size="sm" disabled={draft.length < 3} onClick={() => commitShape(draft)}>
                      <Check /> Finish shape
                    </Button>
                  </>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!editPlot || !data.plots.find((p) => p.id === editPlot && shapeOf(p))}
                  onClick={() => setPending((p) => ({ ...p, [editPlot]: null }))}
                >
                  <Eraser /> Remove shape
                </Button>
              </div>
              <div className="flex gap-2 border-t pt-4">
                <Button className="flex-1" disabled={!dirty} loading={saveShapes.isPending} onClick={() => saveShapes.mutate()}>
                  <Save /> Save {dirty ? `(${Object.keys(pending).length})` : ''}
                </Button>
                <Button variant="outline" disabled={!dirty} onClick={() => setPending({})}>
                  Discard
                </Button>
              </div>
            </Card>
          )}
        </div>
      </div>

      <PlotDrawer
        projectId={projectId}
        plotId={selected}
        onClose={() => setSelected(null)}
        blocks={project.data?.blocks ?? []}
        phases={project.data?.phases ?? []}
      />
    </>
  );
}
