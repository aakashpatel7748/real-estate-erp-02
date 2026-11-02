import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { BookOpenCheck, Lock, LockOpen, Pencil, Stamp, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { applyBasisPoints, MANUAL_PLOT_TRANSITIONS, PLOT_CATEGORIES, PLOT_FACINGS, priceForArea, type PlotStatus } from '@erp/shared';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { areaToSqft, formatDateTime, formatINR, titleCase } from '@/lib/format';
import { Can, useAuth } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Checkbox, Input, Label, Select, Skeleton, Textarea } from '@/components/ui/primitives';
import { ConfirmDialog, Sheet, SheetContent } from '@/components/ui/overlays';
import { DescriptionList, Field, StatusBadge } from '@/components/common';
import { ErrorState } from '@/components/states';
import { areaField, bpToInput, MoneyInput, paiseToInput, percentField, rupeeField, toAreaX100, toBp, toPaise } from '@/components/money';

export interface Plot {
  id: string;
  plotNumber: string;
  blockId?: string | null;
  phaseId?: string | null;
  blockCode?: string;
  category: string;
  facing?: string;
  areaX100: number;
  widthFtX100?: number;
  depthFtX100?: number;
  ratePaisePerSqft: number;
  plcBp: number;
  isCorner: boolean;
  listPricePaise: number;
  status: PlotStatus;
  remarks?: string;
  currentBookingId?: string | null;
  history?: { id: string; from: string | null; to: string; reason?: string; createdAt: string; actorId?: { name: string } }[];
  currentBooking?: {
    id: string;
    bookingNumber: string;
    status: string;
    netAmountPaise: number;
    allocatedPaise: number;
    customerId?: { id: string; name: string; phone: string };
  } | null;
}

const plotForm = z.object({
  plotNumber: z
    .string()
    .trim()
    .min(1, 'Plot number is required')
    .max(20)
    .regex(/^[A-Za-z0-9-/]+$/, 'Letters, digits, - and /'),
  blockId: z.string().optional(),
  phaseId: z.string().optional(),
  category: z.enum(PLOT_CATEGORIES),
  facing: z.string().optional(),
  area: areaField('Area'),
  rate: rupeeField('Rate'),
  plc: percentField('PLC'),
  isCorner: z.boolean(),
  remarks: z.string().max(500).optional(),
});
type PlotForm = z.infer<typeof plotForm>;

export function PlotFormSheet({
  open,
  onOpenChange,
  projectId,
  plot,
  blocks,
  phases,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string;
  plot?: Plot;
  blocks: { id: string; name: string; code: string }[];
  phases: { id: string; name: string }[];
}) {
  const qc = useQueryClient();
  const form = useForm<PlotForm>({
    resolver: zodResolver(plotForm),
    values: {
      plotNumber: plot?.plotNumber ?? '',
      blockId: plot?.blockId ?? '',
      phaseId: plot?.phaseId ?? '',
      category: (plot?.category as PlotForm['category']) ?? 'residential',
      facing: plot?.facing ?? '',
      area: plot ? areaToSqft(plot.areaX100) : '',
      rate: paiseToInput(plot?.ratePaisePerSqft),
      plc: bpToInput(plot?.plcBp),
      isCorner: plot?.isCorner ?? false,
      remarks: plot?.remarks ?? '',
    },
  });
  const locked = plot && !['available', 'blocked'].includes(plot.status);
  const save = useMutation({
    mutationFn: (v: PlotForm) => {
      const payload = {
        plotNumber: v.plotNumber.toUpperCase(),
        blockId: v.blockId || undefined,
        phaseId: v.phaseId || undefined,
        category: v.category,
        facing: v.facing || undefined,
        areaX100: toAreaX100(v.area),
        ratePaisePerSqft: toPaise(v.rate),
        plcBp: toBp(v.plc),
        isCorner: v.isCorner,
        remarks: v.remarks || undefined,
      };
      if (locked) {
        const { facing, remarks, isCorner, category } = payload;
        return api.patch(`/projects/${projectId}/plots/${plot!.id}`, { facing, remarks, isCorner, category });
      }
      return plot ? api.patch(`/projects/${projectId}/plots/${plot.id}`, payload) : api.post(`/projects/${projectId}/plots`, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plots', projectId] });
      qc.invalidateQueries({ queryKey: ['plot'] });
      qc.invalidateQueries({ queryKey: ['map', projectId] });
      toast.success(plot ? 'Plot updated' : 'Plot added');
      onOpenChange(false);
    },
    onError: (err) => {
      const f = fieldErrors(err);
      if (Object.keys(f).length) toast.error(Object.values(f).join(' · '));
      else toast.error(errorMessage(err));
    },
  });
  const e = form.formState.errors;
  const area = form.watch('area');
  const rate = form.watch('rate');
  const plc = form.watch('plc');
  let preview = '';
  try {
    if (area && rate) {
      const base = priceForArea(toAreaX100(area), toPaise(rate));
      preview = formatINR(base + applyBasisPoints(base, toBp(plc || '0')));
    }
  } catch {
    preview = '';
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title={plot ? `Edit plot ${plot.plotNumber}` : 'Add plot'}
        description={locked ? 'Commercial fields are locked while the plot is reserved, booked or sold.' : undefined}
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" form="plot-form" loading={save.isPending}>
              Save
            </Button>
          </>
        }
      >
        <form id="plot-form" className="grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
          <Field label="Plot number" htmlFor="pl-no" error={e.plotNumber?.message} required>
            <Input disabled={locked} {...form.register('plotNumber')} className="uppercase" />
          </Field>
          <Field label="Block" htmlFor="pl-block">
            <Select disabled={locked} {...form.register('blockId')}>
              <option value="">No block</option>
              {blocks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.code})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Phase" htmlFor="pl-phase">
            <Select disabled={locked} {...form.register('phaseId')}>
              <option value="">From block / none</option>
              {phases.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Category" htmlFor="pl-cat">
            <Select {...form.register('category')}>
              {PLOT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {titleCase(c)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Area (sq ft)" htmlFor="pl-area" error={e.area?.message} required>
            <Input disabled={locked} inputMode="decimal" {...form.register('area')} />
          </Field>
          <Field label="Rate (₹ / sq ft)" htmlFor="pl-rate" error={e.rate?.message} required>
            <MoneyInput disabled={locked} {...form.register('rate')} />
          </Field>
          <Field label="PLC (%)" htmlFor="pl-plc" error={e.plc?.message} hint="Preferential location charge">
            <Input disabled={locked} inputMode="decimal" {...form.register('plc')} />
          </Field>
          <Field label="Facing" htmlFor="pl-facing">
            <Select {...form.register('facing')}>
              <option value="">—</option>
              {PLOT_FACINGS.map((f) => (
                <option key={f} value={f}>
                  {titleCase(f)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Checkbox id="pl-corner" checked={form.watch('isCorner')} onCheckedChange={(c) => form.setValue('isCorner', c === true)} />
            <Label htmlFor="pl-corner">Corner plot</Label>
          </div>
          <Field label="Remarks" htmlFor="pl-remarks" className="sm:col-span-2">
            <Textarea rows={2} {...form.register('remarks')} />
          </Field>
          {preview && (
            <div className="rounded-lg bg-muted p-3 text-sm sm:col-span-2">
              List price: <span className="font-semibold tabular">{preview}</span>
            </div>
          )}
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function PlotDrawer({
  projectId,
  plotId,
  onClose,
  blocks,
  phases,
}: {
  projectId: string;
  plotId: string | null;
  onClose: () => void;
  blocks: { id: string; name: string; code: string }[];
  phases: { id: string; name: string }[];
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [editing, setEditing] = React.useState(false);
  const [statusTarget, setStatusTarget] = React.useState<PlotStatus | null>(null);
  const [reason, setReason] = React.useState('');
  const [deleting, setDeleting] = React.useState(false);
  const q = useQuery({
    queryKey: ['plot', projectId, plotId],
    queryFn: () => api.get<Plot>(`/projects/${projectId}/plots/${plotId}`),
    enabled: Boolean(plotId),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['plots', projectId] });
    qc.invalidateQueries({ queryKey: ['plot', projectId, plotId] });
    qc.invalidateQueries({ queryKey: ['map', projectId] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const changeStatus = useMutation({
    mutationFn: (to: PlotStatus) => api.post(`/projects/${projectId}/plots/${plotId}/status`, { status: to, reason }),
    onSuccess: () => {
      invalidate();
      setStatusTarget(null);
      setReason('');
      toast.success('Status updated');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/projects/${projectId}/plots/${plotId}`),
    onSuccess: () => {
      invalidate();
      setDeleting(false);
      onClose();
      toast.success('Plot deleted');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const p = q.data;
  const transitions = p ? MANUAL_PLOT_TRANSITIONS[p.status] : [];
  const statusIcon: Record<string, React.ReactNode> = { blocked: <Lock />, available: <LockOpen />, sold: <Stamp /> };

  return (
    <>
      <Sheet open={Boolean(plotId)} onOpenChange={(o) => !o && onClose()}>
        <SheetContent
          title={p ? `Plot ${p.blockCode ? `${p.blockCode}-` : ''}${p.plotNumber}` : 'Plot'}
          description={
            p ? `${titleCase(p.category)}${p.facing ? ` · ${titleCase(p.facing)} facing` : ''}${p.isCorner ? ' · Corner' : ''}` : undefined
          }
          footer={
            p && (
              <div className="flex w-full flex-wrap justify-between gap-2">
                <div className="flex gap-2">
                  <Can permission="inventory.delete">
                    {(p.status === 'available' || p.status === 'blocked') && (
                      <Button variant="ghost" size="icon" onClick={() => setDeleting(true)} aria-label="Delete plot">
                        <Trash2 />
                      </Button>
                    )}
                  </Can>
                  <Can permission="inventory.update">
                    <Button variant="outline" onClick={() => setEditing(true)}>
                      <Pencil /> Edit
                    </Button>
                  </Can>
                </div>
                {p.status === 'available' && can('bookings.create') && (
                  <Button onClick={() => navigate(`/post-sales/bookings/new?project=${projectId}&plots=${p.id}`)}>
                    <BookOpenCheck /> Book this plot
                  </Button>
                )}
              </div>
            )
          }
        >
          {q.isPending ? (
            <div className="space-y-3">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-24" />
              <Skeleton className="h-40" />
            </div>
          ) : q.isError ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          ) : p ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <StatusBadge status={p.status} kind="plot" />
                <span className="text-xl font-semibold tabular">{formatINR(p.listPricePaise)}</span>
              </div>
              <DescriptionList
                items={[
                  { label: 'Area', value: `${areaToSqft(p.areaX100)} sq ft` },
                  { label: 'Rate', value: `${formatINR(p.ratePaisePerSqft)} / sq ft` },
                  { label: 'PLC', value: p.plcBp ? `${p.plcBp / 100}%` : 'None' },
                  { label: 'Block', value: p.blockCode ?? '—' },
                ]}
              />
              {p.remarks && <p className="text-sm text-muted-foreground">{p.remarks}</p>}

              {p.currentBooking && (
                <div className="rounded-lg border p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Current booking</p>
                  <Link to={`/post-sales/bookings/${p.currentBooking.id}`} className="mt-1 block font-medium text-primary hover:underline">
                    {p.currentBooking.bookingNumber}
                  </Link>
                  <p className="text-sm">
                    {p.currentBooking.customerId?.name} · {p.currentBooking.customerId?.phone}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Paid {formatINR(p.currentBooking.allocatedPaise)} of {formatINR(p.currentBooking.netAmountPaise)}
                  </p>
                </div>
              )}

              {can('inventory.status') && transitions.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-medium">Change status</p>
                  <div className="flex flex-wrap gap-2">
                    {transitions.map((t) => (
                      <Button key={t} variant="outline" size="sm" onClick={() => setStatusTarget(t)}>
                        {statusIcon[t]} Mark {t}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="mb-2 text-sm font-medium">Status history</p>
                <ol className="relative space-y-3 border-l pl-4">
                  {p.history?.map((h) => (
                    <li key={h.id} className="relative text-sm">
                      <span className="absolute -left-[22.5px] top-1 size-3 rounded-full border-2 border-card bg-primary" aria-hidden />
                      <p>
                        {h.from ? `${titleCase(h.from)} → ` : ''}
                        <span className="font-medium">{titleCase(h.to)}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {h.reason} · {h.actorId?.name ?? 'System'} · {formatDateTime(h.createdAt)}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
      {p && <PlotFormSheet open={editing} onOpenChange={setEditing} projectId={projectId} plot={p} blocks={blocks} phases={phases} />}
      <ConfirmDialog
        open={!!statusTarget}
        onOpenChange={(o) => !o && setStatusTarget(null)}
        title={`Mark plot as ${statusTarget}?`}
        description="The change is recorded in the plot history and audit log."
        confirmLabel="Update status"
        loading={changeStatus.isPending}
        onConfirm={() => {
          if (reason.trim().length < 1) return toast.error('Please enter a reason');
          changeStatus.mutate(statusTarget!);
        }}
      >
        <Field label="Reason" htmlFor="status-reason" required>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Management quota" />
        </Field>
      </ConfirmDialog>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this plot?"
        description="Only plots that have never been booked can be deleted."
        destructive
        confirmLabel="Delete"
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}
