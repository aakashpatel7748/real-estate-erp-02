import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowRight, FileDown, Layers, Plus, Save, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { SALES_DOC_STATUSES, todayInIndia, type SalesDocKind } from '@erp/shared';
import { api, download, errorMessage, fieldErrors } from '@/lib/api';
import { formatDate, formatDateTime, formatINR, titleCase } from '@/lib/format';
import { useListParams } from '@/hooks/use-list-params';
import { useProjectContext } from '@/hooks/use-project';
import { Can, useAuth } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardHeader, CardTitle, Checkbox, Label, Select, Textarea, type BadgeVariant } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/overlays';
import { DataTable, type Column } from '@/components/data-table';
import { DescriptionList, Field, PageHeader, StatCard } from '@/components/common';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/states';
import { SearchInput } from '@/components/search-input';
import { FormFields, type FieldDef } from '@/components/master-crud';
import { BookingPicker, ProjectSelect, type BookingOption } from '@/components/pickers';
import { paiseToInput, toPaise } from '@/components/money';
import { WhatsAppButton } from '@/components/whatsapp-button';

interface SalesDoc {
  id: string;
  kind: SalesDocKind;
  number: string;
  status: string;
  date: string;
  amountPaise: number;
  details: Record<string, unknown>;
  remarks?: string;
  duesOverridden?: boolean;
  outstandingAtCreationPaise?: number;
  bookingId?: { id: string; bookingNumber: string; status: string; netAmountPaise?: number; receivedPaise?: number };
  customerId?: { id: string; name: string; phone: string };
  projectId?: { id: string; name: string; code: string };
  history?: { status: string; note?: string; at: string; by?: { name: string } }[];
  consultant?: { name: string; firm?: string } | null;
  units?: { plotNumber: string; blockCode?: string }[];
}

const CONFIG: Record<SalesDocKind, { title: string; singular: string; path: string; description: string; empty: string }> = {
  agreement: {
    title: 'Builder Buyer Agreements',
    singular: 'agreement',
    path: '/post-sales/agreements',
    description: 'Agreements for sale: draft, executed and registered, with stamp duty and registration details',
    empty: 'Create the agreement for a confirmed booking, print it, then mark it executed and registered.',
  },
  registry: {
    title: 'Sale Deed Registry',
    singular: 'registry',
    path: '/post-sales/registry',
    description: 'Sale-deed registrations: scheduling, deed numbers, stamp duty and consultants. Registered units become “sold”.',
    empty: 'Schedule a registry once dues are cleared. Recording the deed number marks the units sold.',
  },
  possession: {
    title: 'Possession Letters',
    singular: 'possession letter',
    path: '/post-sales/possession-letters',
    description: 'Offer possession, then record the handover',
    empty: 'Offer possession to buyers and record when keys are handed over.',
  },
  demand: {
    title: 'Payment Demand Letters',
    singular: 'demand letter',
    path: '/post-sales/demand-letters',
    description: 'Demand letters for installments falling due, with your bank details, ready to print or share',
    empty: 'Issue demand letters for one booking or for every booking in a project at once.',
  },
};
const VARIANT: Record<string, BadgeVariant> = {
  draft: 'muted',
  executed: 'info',
  registered: 'success',
  scheduled: 'warning',
  offered: 'info',
  handed_over: 'success',
  issued: 'info',
  cancelled: 'destructive',
};
const units = (d: Pick<SalesDoc, 'units'>) => d.units?.map((u) => (u.blockCode ? `${u.blockCode}-${u.plotNumber}` : u.plotNumber)).join(', ');
const dateOf = (v: unknown) => (typeof v === 'string' && v ? formatDate(v.slice(0, 10)) : '—');

/** Kind-specific detail fields (money in rupees on the form, paise on the wire). */
function detailFields(kind: SalesDocKind, consultants: { id: string; name: string }[]): FieldDef[] {
  if (kind === 'agreement')
    return [
      { name: 'executedOn', label: 'Executed on', type: 'date' },
      { name: 'registrationNumber', label: 'Registration number', type: 'text' },
      { name: 'stampDutyPaise', label: 'Stamp duty', type: 'money' },
      { name: 'registrationFeePaise', label: 'Registration fee', type: 'money' },
      { name: 'witnesses', label: 'Witnesses', type: 'text', span: 2 },
      { name: 'terms', label: 'Terms (one clause per line; blank = standard terms)', type: 'textarea' },
    ];
  if (kind === 'registry')
    return [
      { name: 'scheduledOn', label: 'Scheduled on', type: 'date' },
      { name: 'subRegistrarOffice', label: 'Sub-registrar office', type: 'text' },
      { name: 'registeredOn', label: 'Registered on', type: 'date' },
      { name: 'deedNumber', label: 'Deed number', type: 'text' },
      { name: 'stampDutyPaise', label: 'Stamp duty', type: 'money' },
      { name: 'registrationFeePaise', label: 'Registration fee', type: 'money' },
      { name: 'consultantId', label: 'Registry consultant', type: 'select', options: consultants.map((c) => ({ value: c.id, label: c.name })), emptyLabel: 'None' },
    ];
  if (kind === 'possession')
    return [
      { name: 'offeredOn', label: 'Possession offered on', type: 'date' },
      { name: 'handedOverOn', label: 'Handed over on', type: 'date' },
      { name: 'possessionType', label: 'Type', type: 'select', options: [{ value: 'physical', label: 'Physical' }, { value: 'paper', label: 'Paper (symbolic)' }], emptyLabel: '—' },
      { name: 'keysHandedTo', label: 'Keys received by', type: 'text' },
    ];
  return [];
}

function toDetailsPayload(fields: FieldDef[], values: Record<string, unknown>, forUpdate: boolean) {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values[f.name];
    const blank = v === '' || v === undefined;
    if (blank) {
      if (forUpdate) out[f.name] = null;
      continue;
    }
    out[f.name] = f.type === 'money' ? toPaise(String(v)) : v;
  }
  return out;
}

function useConsultants(enabled: boolean) {
  return useQuery({
    queryKey: ['consultants', 'options'],
    queryFn: () => api.page<{ id: string; name: string }>('/consultants', { pageSize: 100, active: 'true' }),
    enabled,
    select: (r) => r.items,
  });
}

export function SalesDocsPage({ kind }: { kind: SalesDocKind }) {
  const cfg = CONFIG[kind];
  const navigate = useNavigate();
  const { projectId } = useProjectContext();
  const lp = useListParams({ sort: '-date' });
  const status = lp.filter('status');
  const query = { ...lp.query, kind, status, projectId: projectId ?? undefined };
  const q = useQuery({ queryKey: ['sales-docs', query], queryFn: () => api.page<SalesDoc>('/post-sales/documents', query) });
  const summary = useQuery({ queryKey: ['sales-docs', 'summary', kind, projectId], queryFn: () => api.get<Record<string, number>>('/post-sales/documents/summary', { kind, projectId: projectId ?? undefined }) });
  const [creating, setCreating] = React.useState(false);
  const [bulk, setBulk] = React.useState(false);
  const statuses = SALES_DOC_STATUSES[kind];
  const columns: Column<SalesDoc>[] = [
    { key: 'number', header: 'Reference', sortKey: 'number', cell: (r) => <span className="font-medium">{r.number}</span> },
    { key: 'date', header: 'Date', sortKey: 'date', cell: (r) => formatDate(r.date.slice(0, 10)) },
    { key: 'booking', header: 'Booking', cell: (r) => r.bookingId?.bookingNumber ?? '—' },
    { key: 'customer', header: 'Customer', cell: (r) => r.customerId?.name ?? '—' },
    { key: 'project', header: 'Project', hideOnMobile: true, cell: (r) => r.projectId?.name ?? '—' },
    ...(kind === 'registry'
      ? ([
          { key: 'deed', header: 'Deed / scheduled', cell: (r) => (r.details.deedNumber ? String(r.details.deedNumber) : `Scheduled ${dateOf(r.details.scheduledOn)}`) },
        ] as Column<SalesDoc>[])
      : kind === 'possession'
        ? ([{ key: 'handover', header: 'Handover', cell: (r) => (r.details.handedOverOn ? dateOf(r.details.handedOverOn) : `Offered ${dateOf(r.details.offeredOn ?? r.date)}`) }] as Column<SalesDoc>[])
        : kind === 'agreement'
          ? ([{ key: 'executed', header: 'Executed', cell: (r) => dateOf(r.details.executedOn) }] as Column<SalesDoc>[])
          : ([{ key: 'payBy', header: 'Pay by', cell: (r) => dateOf(r.details.payBy) }] as Column<SalesDoc>[])),
    ...(kind !== 'possession'
      ? ([{ key: 'amount', header: kind === 'demand' ? 'Demanded' : 'Stamp + fees', sortKey: 'amountPaise', align: 'right', cell: (r) => <span className="tabular">{r.amountPaise ? formatINR(r.amountPaise) : '—'}</span> }] as Column<SalesDoc>[])
      : []),
    { key: 'status', header: 'Status', sortKey: 'status', cell: (r) => <Badge variant={VARIANT[r.status] ?? 'secondary'}>{titleCase(r.status)}</Badge> },
  ];
  return (
    <>
      <PageHeader
        title={cfg.title}
        description={cfg.description}
        actions={
          <Can permission="postSales.create">
            {kind === 'demand' && (
              <Button variant="outline" onClick={() => setBulk(true)}>
                <Layers /> Issue for a project
              </Button>
            )}
            <Button onClick={() => setCreating(true)}>
              <Plus /> New {cfg.singular}
            </Button>
          </Can>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statuses.map((s) => (
          <StatCard key={s} label={titleCase(s)} value={summary.data?.[s] ?? 0} loading={summary.isPending} />
        ))}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput value={lp.q} onChange={lp.setQ} placeholder="Search reference" className="w-full sm:w-64" />
        <Select className="h-9 w-auto" value={status ?? ''} onChange={(e) => lp.setFilter('status', e.target.value || undefined)} aria-label="Status">
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {titleCase(s)}
            </option>
          ))}
        </Select>
      </div>
      <DataTable
        columns={columns}
        rows={q.data?.items}
        rowKey={(r) => r.id}
        loading={q.isPending}
        error={q.error}
        onRetry={() => q.refetch()}
        meta={q.data?.meta}
        onPageChange={lp.setPage}
        pageSize={lp.pageSize}
        onPageSizeChange={lp.setPageSize}
        sort={lp.sort}
        onSortChange={lp.setSort}
        onRowClick={(r) => navigate(`${cfg.path}/${r.id}`)}
        empty={<EmptyState title={`No ${cfg.title.toLowerCase()} yet`} description={cfg.empty} />}
      />
      <CreateDocDialog kind={kind} open={creating} onOpenChange={setCreating} />
      {kind === 'demand' && <BulkDemandDialog open={bulk} onOpenChange={setBulk} />}
    </>
  );
}

function DuesOverride({ value, onChange, settingsHint }: { value: boolean; onChange: (v: boolean) => void; settingsHint?: boolean }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
      <Checkbox id="override-dues" checked={value} onCheckedChange={(c) => onChange(c === true)} className="mt-0.5" />
      <Label htmlFor="override-dues" className="font-normal leading-snug">
        Proceed even if dues are outstanding (a remark is required){settingsHint ? '. The rule is set in Administration → Settings.' : '.'}
      </Label>
    </div>
  );
}

function CreateDocDialog({ kind, open, onOpenChange }: { kind: SalesDocKind; open: boolean; onOpenChange: (o: boolean) => void }) {
  const cfg = CONFIG[kind];
  const qc = useQueryClient();
  const navigate = useNavigate();
  const consultants = useConsultants(open && kind === 'registry');
  const fields = detailFields(kind, consultants.data ?? []);
  const [booking, setBooking] = React.useState<BookingOption | null>(null);
  const [date, setDate] = React.useState(todayInIndia());
  const [values, setValues] = React.useState<Record<string, unknown>>({});
  const [remarks, setRemarks] = React.useState('');
  const [override, setOverride] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [dueUpTo, setDueUpTo] = React.useState('');
  const [payBy, setPayBy] = React.useState('');
  React.useEffect(() => {
    if (open) {
      setBooking(null);
      setDate(todayInIndia());
      setValues(kind === 'possession' ? { offeredOn: todayInIndia(), possessionType: 'physical' } : {});
      setRemarks('');
      setOverride(false);
      setErrors({});
      setDueUpTo('');
      setPayBy('');
    }
  }, [open, kind]);
  const save = useMutation({
    mutationFn: () =>
      api.post<SalesDoc>('/post-sales/documents', {
        kind,
        bookingId: booking!.id,
        date,
        remarks: remarks || undefined,
        ...(kind === 'demand' ? { dueUpTo: dueUpTo || undefined, payBy: payBy || undefined } : { details: toDetailsPayload(fields, values, false) }),
        ...(kind === 'registry' || kind === 'possession' ? { overrideDues: override } : {}),
      }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['sales-docs'] });
      toast.success(`${d.number} created`);
      onOpenChange(false);
      navigate(`${cfg.path}/${d.id}`);
    },
    onError: (e) => {
      setErrors(Object.fromEntries(Object.entries(fieldErrors(e)).map(([k, v]) => [k.replace(/^details\./, ''), v])));
      toast.error(errorMessage(e));
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`New ${cfg.singular}`} className="max-w-2xl">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Booking" htmlFor="sd-booking" required className="sm:col-span-2" hint={kind === 'demand' ? undefined : 'Only confirmed bookings'}>
            <BookingPicker id="sd-booking" value={booking} onChange={setBooking} statuses={kind === 'demand' ? ['booked', 'reserved'] : ['booked']} />
          </Field>
          <Field label="Date" htmlFor="sd-date" required>
            <input id="sd-date" type="date" className="h-9 rounded-md border bg-card px-3 text-sm" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          {kind === 'demand' && (
            <>
              <Field label="Include dues up to" htmlFor="sd-due" hint="Defaults to the date plus the lead days in Settings">
                <input id="sd-due" type="date" className="h-9 rounded-md border bg-card px-3 text-sm" value={dueUpTo} min={date} onChange={(e) => setDueUpTo(e.target.value)} />
              </Field>
              <Field label="Pay by" htmlFor="sd-payby" hint="Defaults to 7 days from the date">
                <input id="sd-payby" type="date" className="h-9 rounded-md border bg-card px-3 text-sm" value={payBy} min={date} onChange={(e) => setPayBy(e.target.value)} />
              </Field>
            </>
          )}
        </div>
        {fields.length > 0 && <FormFields fields={fields} values={values} onChange={setValues} errors={errors} idPrefix="sd" />}
        <Field label="Remarks" htmlFor="sd-remarks">
          <Textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
        {(kind === 'registry' || kind === 'possession') && <DuesOverride value={override} onChange={setOverride} settingsHint />}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!booking} onClick={() => save.mutate()}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkDemandDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { projectId: ctxProject } = useProjectContext();
  const [projectId, setProjectId] = React.useState(ctxProject ?? '');
  const [date, setDate] = React.useState(todayInIndia());
  const [dueUpTo, setDueUpTo] = React.useState('');
  const save = useMutation({
    mutationFn: () => api.post<{ created: number; skipped: number }>('/post-sales/documents/demand/bulk', { projectId, date, dueUpTo: dueUpTo || undefined }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['sales-docs'] });
      toast.success(`${r.created} demand letters issued${r.skipped ? `, ${r.skipped} skipped (already issued today)` : ''}`);
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Issue demand letters for a project" description="One letter per active booking with installments due by the cut-off date.">
        <Field label="Project" htmlFor="bd-project" required>
          <ProjectSelect id="bd-project" value={projectId} onChange={setProjectId} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Letter date" htmlFor="bd-date" required>
            <input id="bd-date" type="date" className="h-9 rounded-md border bg-card px-3 text-sm" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Include dues up to" htmlFor="bd-due" hint="Blank = letter date + lead days">
            <input id="bd-due" type="date" className="h-9 rounded-md border bg-card px-3 text-sm" value={dueUpTo} min={date} onChange={(e) => setDueUpTo(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!projectId} onClick={() => save.mutate()}>
            Issue letters
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------- Detail ----------------

const NEXT: Record<SalesDocKind, Record<string, { to: string; label: string }[]>> = {
  agreement: { draft: [{ to: 'executed', label: 'Mark executed' }], executed: [{ to: 'registered', label: 'Mark registered' }] },
  registry: { scheduled: [{ to: 'registered', label: 'Mark registered' }] },
  possession: { offered: [{ to: 'handed_over', label: 'Record handover' }] },
  demand: {},
};

export function SalesDocDetailPage({ kind }: { kind: SalesDocKind }) {
  const cfg = CONFIG[kind];
  const { id } = useParams();
  const qc = useQueryClient();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['sales-doc', id], queryFn: () => api.get<SalesDoc>(`/post-sales/documents/${id}`) });
  const consultants = useConsultants(kind === 'registry');
  const fields = detailFields(kind, consultants.data ?? []);
  const [values, setValues] = React.useState<Record<string, unknown>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [transition, setTransition] = React.useState<{ to: string; label: string } | null>(null);
  const [remarks, setRemarks] = React.useState('');
  const [override, setOverride] = React.useState(false);
  React.useEffect(() => {
    if (!q.data) return;
    const v: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = q.data.details[f.name];
      v[f.name] = raw === undefined || raw === null ? '' : f.type === 'money' ? paiseToInput(Number(raw)) : f.name === 'consultantId' ? String(raw) : String(raw).slice(0, f.type === 'date' ? 10 : undefined);
    }
    setValues(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, consultants.data]);
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['sales-doc', id] });
    qc.invalidateQueries({ queryKey: ['sales-docs'] });
  };
  const saveDetails = useMutation({
    mutationFn: () => api.patch(`/post-sales/documents/${id}`, { details: toDetailsPayload(fields, values, true) }),
    onSuccess: () => {
      invalidate();
      setErrors({});
      toast.success('Details saved');
    },
    onError: (e) => {
      setErrors(fieldErrors(e));
      toast.error(errorMessage(e));
    },
  });
  const move = useMutation({
    mutationFn: (to: string) =>
      api.patch(`/post-sales/documents/${id}`, {
        status: to,
        remarks: remarks || undefined,
        overrideDues: override,
        ...(to !== 'cancelled' && kind !== 'demand' ? { details: toDetailsPayload(fields, values, true) } : {}),
      }),
    onSuccess: (_d, to) => {
      invalidate();
      qc.invalidateQueries({ queryKey: ['plots'] });
      setTransition(null);
      setRemarks('');
      setOverride(false);
      toast.success(to === 'cancelled' ? 'Cancelled' : `Marked ${titleCase(to).toLowerCase()}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const editable = can('postSales.update') && d.status !== 'cancelled';
  const lines = (d.details.lines as { name: string; dueDate: string; amountPaise: number; paidPaise: number; balancePaise: number }[] | undefined) ?? [];
  const needsDuesCheck = transition && ((kind === 'registry' && transition.to === 'registered') || (kind === 'possession' && transition.to === 'handed_over'));
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: cfg.title, to: cfg.path }, { label: d.number }]}
        title={
          <span className="flex items-center gap-3">
            {d.number} <Badge variant={VARIANT[d.status] ?? 'secondary'}>{titleCase(d.status)}</Badge>
          </span>
        }
        description={`${d.customerId?.name ?? ''} · ${d.bookingId?.bookingNumber ?? ''} · ${d.projectId?.name ?? ''}`}
        actions={
          <>
            <Button variant="outline" onClick={() => void download(`/post-sales/documents/${d.id}/pdf`, undefined, 'open')}>
              <FileDown /> Print / PDF
            </Button>
            {d.bookingId && (kind === 'demand' || kind === 'possession') && (
              <WhatsAppButton entityType="booking" entityId={d.bookingId.id} categories={kind === 'demand' ? ['demand', 'payment_reminder'] : ['possession']} size="default" />
            )}
            {editable &&
              (NEXT[kind][d.status] ?? []).map((t) => (
                <Button key={t.to} onClick={() => setTransition(t)}>
                  {t.label} <ArrowRight />
                </Button>
              ))}
            {editable && SALES_DOC_STATUSES[kind].includes('cancelled') && (kind === 'agreement' || ['scheduled', 'offered', 'issued'].includes(d.status)) && (
              <Button variant="ghost" className="text-destructive" onClick={() => setTransition({ to: 'cancelled', label: 'Cancel' })}>
                <XCircle /> Cancel
              </Button>
            )}
          </>
        }
      />
      {d.duesOverridden && (
        <p className="mb-4 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="size-4" /> Created with {formatINR(d.outstandingAtCreationPaise ?? 0)} outstanding (override). {d.remarks}
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {kind === 'demand' ? (
            <Card>
              <CardHeader>
                <CardTitle>Installments demanded</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="py-2 font-medium">Installment</th>
                      <th className="py-2 font-medium">Due</th>
                      <th className="py-2 text-right font-medium">Amount</th>
                      <th className="py-2 text-right font-medium">Paid</th>
                      <th className="py-2 text-right font-medium">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {lines.map((l) => (
                      <tr key={`${l.name}-${l.dueDate}`}>
                        <td className="py-2">{l.name}</td>
                        <td className="py-2">{formatDate(l.dueDate)}</td>
                        <td className="py-2 text-right tabular">{formatINR(l.amountPaise)}</td>
                        <td className="py-2 text-right tabular">{formatINR(l.paidPaise)}</td>
                        <td className="py-2 text-right font-medium tabular">{formatINR(l.balancePaise)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t font-semibold">
                      <td className="pt-2" colSpan={4}>
                        Total demanded · pay by {dateOf(d.details.payBy)}
                      </td>
                      <td className="pt-2 text-right tabular">{formatINR(d.amountPaise)}</td>
                    </tr>
                  </tfoot>
                </table>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>Details</CardTitle>
                {editable && (
                  <Button size="sm" variant="outline" loading={saveDetails.isPending} onClick={() => saveDetails.mutate()}>
                    <Save /> Save details
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                <fieldset disabled={!editable}>
                  <FormFields fields={fields} values={values} onChange={setValues} errors={errors} idPrefix="sdd" />
                </fieldset>
              </CardContent>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Booking</CardTitle>
            </CardHeader>
            <CardContent>
              <DescriptionList
                className="sm:grid-cols-1"
                items={[
                  {
                    label: 'Booking',
                    value: d.bookingId ? (
                      <Link to={`/post-sales/bookings/${d.bookingId.id}`} className="text-primary hover:underline">
                        {d.bookingId.bookingNumber}
                      </Link>
                    ) : (
                      '—'
                    ),
                  },
                  { label: 'Customer', value: d.customerId ? `${d.customerId.name} · ${d.customerId.phone}` : '—' },
                  { label: 'Units', value: units(d) || '—' },
                  { label: 'Consideration', value: d.bookingId?.netAmountPaise !== undefined ? formatINR(d.bookingId.netAmountPaise) : '—' },
                  { label: 'Received', value: d.bookingId?.receivedPaise !== undefined ? formatINR(d.bookingId.receivedPaise) : '—' },
                  { label: 'Document date', value: formatDate(d.date.slice(0, 10)) },
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3">
                {(d.history ?? []).map((h, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-hidden />
                    <span>
                      <span className="font-medium">{titleCase(h.status)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {h.by?.name ?? ''} · {formatDateTime(h.at)}
                      </span>
                      {h.note && <span className="block text-xs">{h.note}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
      <Dialog open={!!transition} onOpenChange={(o) => !o && setTransition(null)}>
        <DialogContent title={`${transition?.label ?? ''} – ${d.number}`} description={transition?.to === 'registered' && kind === 'registry' ? 'The deed number and registration date from Details are saved, and the units are marked sold.' : undefined}>
          <Field label="Remarks" htmlFor="tr-remarks">
            <Textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
          {needsDuesCheck && <DuesOverride value={override} onChange={setOverride} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransition(null)}>
              Back
            </Button>
            <Button variant={transition?.to === 'cancelled' ? 'destructive' : 'default'} loading={move.isPending} onClick={() => transition && move.mutate(transition.to)}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
