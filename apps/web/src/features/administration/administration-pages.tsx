import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building, Landmark, Layers, Pencil, Plus, Trash2, Wallet, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { PLOT_CATEGORIES, todayInIndia, UNIT_TYPES } from '@erp/shared';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { formatDate, formatINR, titleCase } from '@/lib/format';
import { useProjectContext } from '@/hooks/use-project';
import { Can, useAuth } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives';
import { ConfirmDialog, Dialog, DialogContent, DialogFooter } from '@/components/ui/overlays';
import { PageHeader, StatCard } from '@/components/common';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/states';
import { FormFields, MasterCrud, type FieldDef } from '@/components/master-crud';
import { toPaise } from '@/components/money';

// =====================================================================
// Phases / Towers
// =====================================================================

interface Units {
  total: number;
  available?: number;
  reserved?: number;
  booked?: number;
  sold?: number;
  blocked?: number;
}
interface Phase {
  id: string;
  name: string;
  code: string;
  sequence: number;
  startDate?: string;
  targetDate?: string;
  units: Units;
}
interface Block {
  id: string;
  name: string;
  code: string;
  phaseId?: string;
  units: Units;
}
interface StructureProject {
  id: string;
  name: string;
  code: string;
  status: string;
  phases: Phase[];
  blocks: Block[];
}

function UnitBar({ u }: { u: Units }) {
  if (!u.total) return <span className="text-xs text-muted-foreground">No units</span>;
  const parts = [
    ['available', 'var(--plot-available)'],
    ['reserved', 'var(--plot-reserved)'],
    ['booked', 'var(--plot-booked)'],
    ['sold', 'var(--plot-sold)'],
    ['blocked', 'var(--plot-blocked)'],
  ] as const;
  return (
    <div className="min-w-40">
      <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
        {parts.map(([k, c]) => (u[k] ? <span key={k} style={{ width: `${((u[k] ?? 0) / u.total) * 100}%`, background: c }} /> : null))}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {u.total} units · {u.available ?? 0} available · {(u.booked ?? 0) + (u.sold ?? 0)} sold/booked
      </p>
    </div>
  );
}

type Editing = { kind: 'phase' | 'block'; projectId: string; row?: Phase | Block; phases: Phase[] };

export function PhasesTowersPage() {
  const { projectId } = useProjectContext();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['structure', projectId], queryFn: () => api.get<StructureProject[]>('/structure', { projectId: projectId ?? undefined }) });
  const [editing, setEditing] = React.useState<Editing | null>(null);
  const [deleting, setDeleting] = React.useState<{ kind: 'phase' | 'block'; projectId: string; row: Phase | Block } | null>(null);
  const remove = useMutation({
    mutationFn: (d: NonNullable<typeof deleting>) => api.delete(`/projects/${d.projectId}/${d.kind === 'phase' ? 'phases' : 'blocks'}/${d.row.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['structure'] });
      setDeleting(null);
      toast.success('Deleted');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <>
      <PageHeader title="Phases / Towers" description="Development phases and towers (blocks) of every project, with unit status" />
      {!q.data.length && <EmptyState title="No projects yet" description="Create a project first, then add its phases and towers here." />}
      <div className="space-y-6">
        {q.data.map((p) => (
          <Card key={p.id}>
            <CardHeader className="flex-row items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <Building className="size-4 text-muted-foreground" /> {p.name} <span className="text-sm font-normal text-muted-foreground">{p.code}</span>
              </CardTitle>
              <Can permission="projects.update">
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing({ kind: 'phase', projectId: p.id, phases: p.phases })}>
                    <Plus /> Phase
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditing({ kind: 'block', projectId: p.id, phases: p.phases })}>
                    <Plus /> Tower / block
                  </Button>
                </div>
              </Can>
            </CardHeader>
            <CardContent className="grid gap-6 lg:grid-cols-2">
              <StructureList
                title="Phases"
                icon={Layers}
                rows={p.phases}
                sub={(r) => {
                  const ph = r as Phase;
                  return [ph.startDate && `Start ${formatDate(ph.startDate.slice(0, 10))}`, ph.targetDate && `Target ${formatDate(ph.targetDate.slice(0, 10))}`].filter(Boolean).join(' · ');
                }}
                onEdit={(r) => setEditing({ kind: 'phase', projectId: p.id, row: r, phases: p.phases })}
                onDelete={(r) => setDeleting({ kind: 'phase', projectId: p.id, row: r })}
              />
              <StructureList
                title="Towers / blocks"
                icon={Building}
                rows={p.blocks}
                sub={(r) => p.phases.find((ph) => ph.id === (r as Block).phaseId)?.name ?? ''}
                onEdit={(r) => setEditing({ kind: 'block', projectId: p.id, row: r, phases: p.phases })}
                onDelete={(r) => setDeleting({ kind: 'block', projectId: p.id, row: r })}
              />
            </CardContent>
          </Card>
        ))}
      </div>
      <StructureDialog editing={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.row.name}?`}
        description="Only empty phases and towers (with no units) can be deleted."
        destructive
        confirmLabel="Delete"
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </>
  );
}

function StructureList({
  title,
  icon: Icon,
  rows,
  sub,
  onEdit,
  onDelete,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  rows: (Phase | Block)[];
  sub: (r: Phase | Block) => string;
  onEdit: (r: Phase | Block) => void;
  onDelete: (r: Phase | Block) => void;
}) {
  const { can } = useAuth();
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Icon className="size-4 text-muted-foreground" /> {title} <span className="font-normal text-muted-foreground">({rows.length})</span>
      </h3>
      {!rows.length ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">None yet</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {r.name} <span className="text-xs text-muted-foreground">{r.code}</span>
                </p>
                {sub(r) && <p className="text-xs text-muted-foreground">{sub(r)}</p>}
              </div>
              <UnitBar u={r.units} />
              {can('projects.update') && (
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon-sm" onClick={() => onEdit(r)} aria-label={`Edit ${r.name}`}>
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => onDelete(r)} aria-label={`Delete ${r.name}`} disabled={r.units.total > 0}>
                    <Trash2 />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StructureDialog({ editing, onClose }: { editing: Editing | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [values, setValues] = React.useState<Record<string, unknown>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    if (!editing) return;
    const r = editing.row as (Phase & Block) | undefined;
    setValues({
      name: r?.name ?? '',
      code: r?.code ?? '',
      sequence: r?.sequence ? String(r.sequence) : '1',
      startDate: r?.startDate?.slice(0, 10) ?? '',
      targetDate: r?.targetDate?.slice(0, 10) ?? '',
      phaseId: r?.phaseId ?? '',
    });
    setErrors({});
  }, [editing]);
  const isPhase = editing?.kind === 'phase';
  const fields: FieldDef[] = isPhase
    ? [
        { name: 'name', label: 'Phase name', type: 'text', required: true },
        { name: 'code', label: 'Code', type: 'upper', required: true, placeholder: 'P1' },
        { name: 'sequence', label: 'Sequence', type: 'number' },
        { name: 'startDate', label: 'Start date', type: 'date' },
        { name: 'targetDate', label: 'Target completion', type: 'date' },
      ]
    : [
        { name: 'name', label: 'Tower / block name', type: 'text', required: true, placeholder: 'Tower A' },
        { name: 'code', label: 'Code', type: 'upper', required: true, placeholder: 'TA' },
        { name: 'phaseId', label: 'Phase', type: 'select', options: (editing?.phases ?? []).map((p) => ({ value: p.id, label: p.name })), emptyLabel: 'No phase' },
      ];
  const save = useMutation({
    mutationFn: () => {
      const base = `/projects/${editing!.projectId}/${isPhase ? 'phases' : 'blocks'}`;
      const body = isPhase
        ? {
            name: values.name,
            code: String(values.code).toUpperCase(),
            sequence: Number(values.sequence) || 1,
            startDate: values.startDate || undefined,
            targetDate: values.targetDate || undefined,
          }
        : { name: values.name, code: String(values.code).toUpperCase(), phaseId: values.phaseId || undefined };
      return editing!.row ? api.patch(`${base}/${editing!.row.id}`, body) : api.post(base, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['structure'] });
      qc.invalidateQueries({ queryKey: ['project'] });
      toast.success('Saved');
      onClose();
    },
    onError: (e) => {
      setErrors(fieldErrors(e));
      toast.error(errorMessage(e));
    },
  });
  return (
    <Dialog open={!!editing} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`${editing?.row ? 'Edit' : 'New'} ${isPhase ? 'phase' : 'tower / block'}`}>
        <FormFields fields={fields} values={values} onChange={setValues} errors={errors} idPrefix="struct" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =====================================================================
// Bank & cash accounts
// =====================================================================

interface CashBank {
  id: string;
  code: string;
  name: string;
  kind: 'bank' | 'cash';
  systemKey?: string;
  isActive: boolean;
  balancePaise: number;
  inflowPaise: number;
  outflowPaise: number;
  lastTransactionOn?: string;
  bankDetails?: { bankName?: string; accountNumber?: string; ifsc?: string; branch?: string; accountType?: string; isReraAccount?: boolean };
}

const mask = (n?: string) => (n ? `•••• ${n.slice(-4)}` : '');

export function BankCashAccountsPage() {
  const q = useQuery({ queryKey: ['cash-bank'], queryFn: () => api.get<CashBank[]>('/cash-bank-accounts') });
  const [editing, setEditing] = React.useState<CashBank | 'new' | null>(null);
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const total = (k: 'bank' | 'cash') => q.data.filter((a) => a.kind === k && a.isActive).reduce((s, a) => s + a.balancePaise, 0);
  return (
    <>
      <PageHeader
        title="Bank & Cash Accounts"
        description="Where receipts are deposited and payments are made from. Balances come straight from the books."
        actions={
          <Can permission="accounting.manageAccounts">
            <Button onClick={() => setEditing('new')}>
              <Plus /> New account
            </Button>
          </Can>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Bank balance" value={formatINR(total('bank'))} icon={Landmark} />
        <StatCard label="Cash in hand" value={formatINR(total('cash'))} icon={Wallet} />
        <StatCard label="Accounts" value={q.data.filter((a) => a.isActive).length} hint={`${q.data.filter((a) => a.bankDetails?.isReraAccount).length} RERA designated`} />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {q.data.map((a) => (
          <Card key={a.id} className={a.isActive ? '' : 'opacity-60'}>
            <CardHeader className="flex-row items-start justify-between gap-2 pb-2">
              <div className="min-w-0">
                <CardTitle className="flex items-center gap-2 truncate text-base">
                  {a.kind === 'bank' ? <Landmark className="size-4 text-muted-foreground" /> : <Wallet className="size-4 text-muted-foreground" />}
                  {a.name}
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  {a.code}
                  {a.bankDetails?.bankName && ` · ${a.bankDetails.bankName}`}
                  {a.bankDetails?.accountNumber && ` · ${mask(a.bankDetails.accountNumber)}`}
                </p>
              </div>
              <div className="flex gap-1">
                {a.bankDetails?.isReraAccount && <Badge variant="info">RERA</Badge>}
                {a.systemKey && <Badge variant="muted">Default</Badge>}
                {!a.isActive && <Badge variant="muted">Inactive</Badge>}
              </div>
            </CardHeader>
            <CardContent>
              <p className={`text-2xl font-semibold tabular ${a.balancePaise < 0 ? 'text-destructive' : ''}`}>{formatINR(a.balancePaise)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                In {formatINR(a.inflowPaise)} · Out {formatINR(a.outflowPaise)}
                {a.lastTransactionOn && ` · Last ${formatDate(a.lastTransactionOn.slice(0, 10))}`}
              </p>
              {a.bankDetails?.ifsc && (
                <p className="mt-2 text-xs text-muted-foreground">
                  IFSC {a.bankDetails.ifsc}
                  {a.bankDetails.branch && ` · ${a.bankDetails.branch}`}
                  {a.bankDetails.accountType && ` · ${titleCase(a.bankDetails.accountType)}`}
                </p>
              )}
              <Can permission="accounting.manageAccounts">
                <Button variant="outline" size="sm" className="mt-3" onClick={() => setEditing(a)}>
                  <Pencil /> Edit
                </Button>
              </Can>
            </CardContent>
          </Card>
        ))}
      </div>
      <CashBankDialog editing={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function CashBankDialog({ editing, onClose }: { editing: CashBank | 'new' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const row = editing && editing !== 'new' ? editing : undefined;
  const [values, setValues] = React.useState<Record<string, unknown>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    if (!editing) return;
    setValues({
      kind: row?.kind ?? 'bank',
      name: row?.name ?? '',
      bankName: row?.bankDetails?.bankName ?? '',
      accountNumber: row?.bankDetails?.accountNumber ?? '',
      ifsc: row?.bankDetails?.ifsc ?? '',
      branch: row?.bankDetails?.branch ?? '',
      accountType: row?.bankDetails?.accountType ?? 'current',
      isReraAccount: row?.bankDetails?.isReraAccount ?? false,
      isActive: row?.isActive ?? true,
      opening: '',
      openingDate: todayInIndia(),
    });
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  const bank = values.kind === 'bank';
  const fields: FieldDef[] = [
    ...(row ? [] : [{ name: 'kind', label: 'Type', type: 'select', required: true, options: [{ value: 'bank', label: 'Bank account' }, { value: 'cash', label: 'Cash / petty cash' }] } as FieldDef]),
    { name: 'name', label: 'Account name', type: 'text', required: true, span: 2, placeholder: bank ? 'HDFC – RERA collection' : 'Site office cash' },
    ...(bank
      ? ([
          { name: 'bankName', label: 'Bank', type: 'text' },
          { name: 'branch', label: 'Branch', type: 'text' },
          { name: 'accountNumber', label: 'Account number', type: 'text' },
          { name: 'ifsc', label: 'IFSC', type: 'upper' },
          { name: 'accountType', label: 'Account type', type: 'select', options: ['current', 'savings', 'cc', 'od', 'escrow'] },
          { name: 'isReraAccount', label: 'RERA designated (70%) account', type: 'checkbox' },
        ] as FieldDef[])
      : []),
    ...(row
      ? ([{ name: 'isActive', label: 'Active', type: 'checkbox' }] as FieldDef[])
      : ([
          { name: 'opening', label: 'Opening balance', type: 'money', hint: 'Posted against owner’s capital' },
          { name: 'openingDate', label: 'As on', type: 'date' },
        ] as FieldDef[])),
  ];
  const save = useMutation({
    mutationFn: () => {
      const s = (k: string) => (values[k] ? String(values[k]).trim() : undefined);
      const details = bank
        ? { bankName: s('bankName'), accountNumber: s('accountNumber'), ifsc: s('ifsc')?.toUpperCase(), branch: s('branch'), accountType: s('accountType'), isReraAccount: values.isReraAccount === true }
        : {};
      if (row) return api.patch(`/cash-bank-accounts/${row.id}`, { name: s('name'), ...details, isActive: values.isActive === true });
      return api.post('/cash-bank-accounts', {
        kind: values.kind,
        name: s('name'),
        ...details,
        openingBalancePaise: values.opening ? toPaise(String(values.opening)) : 0,
        openingDate: s('openingDate'),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cash-bank'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      toast.success('Account saved');
      onClose();
    },
    onError: (e) => {
      setErrors(fieldErrors(e));
      toast.error(errorMessage(e));
    },
  });
  return (
    <Dialog open={!!editing} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={row ? `Edit ${row.name}` : 'New bank or cash account'} className="max-w-xl">
        <FormFields fields={fields} values={values} onChange={setValues} errors={errors} idPrefix="cb" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =====================================================================
// Rate & price indexes
// =====================================================================

interface RateIndex {
  id: string;
  name: string;
  ratePaisePerSqft: number;
  plcBp?: number;
  effectiveFrom: string;
  unitType?: string;
  category?: string;
  notes?: string;
  projectId?: { id: string; name: string; code: string };
  phaseId?: { id: string; name: string };
  blockId?: { id: string; name: string };
  applications?: { at: string; unitsRepriced: number }[];
}

function ApplyRateButton({ row }: { row: RateIndex }) {
  const qc = useQueryClient();
  const [preview, setPreview] = React.useState<{ units: number; valueBeforePaise: number; valueAfterPaise: number } | null>(null);
  const dry = useMutation({
    mutationFn: () => api.post<{ units: number; valueBeforePaise: number; valueAfterPaise: number }>(`/rate-indexes/${row.id}/apply`, { dryRun: true }),
    onSuccess: setPreview,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const apply = useMutation({
    mutationFn: () => api.post<{ units: number }>(`/rate-indexes/${row.id}/apply`, {}),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['rate-indexes'] });
      qc.invalidateQueries({ queryKey: ['plots'] });
      toast.success(`${r.units} units repriced`);
      setPreview(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <>
      <Button variant="outline" size="sm" loading={dry.isPending} onClick={() => dry.mutate()}>
        <Wand2 /> Apply
      </Button>
      <ConfirmDialog
        open={!!preview}
        onOpenChange={(o) => !o && setPreview(null)}
        title={`Apply ${row.name}?`}
        description={
          preview?.units
            ? `${preview.units} available or blocked units will move to ${formatINR(row.ratePaisePerSqft)}/sq ft. Inventory value changes from ${formatINR(preview.valueBeforePaise)} to ${formatINR(preview.valueAfterPaise)}. Reserved, booked and sold units keep their price.`
            : 'No available units match this rate index.'
        }
        confirmLabel="Reprice units"
        loading={apply.isPending}
        onConfirm={() => (preview?.units ? apply.mutate() : setPreview(null))}
      />
    </>
  );
}

export function RateIndexesPage() {
  const fields: FieldDef[] = [
    { name: 'name', label: 'Name', type: 'text', required: true, span: 2, placeholder: 'Rate revision – Oct 2026' },
    { name: 'projectId', label: 'Project', type: 'project', required: true },
    { name: 'effectiveFrom', label: 'Effective from', type: 'date', required: true },
    { name: 'ratePaisePerSqft', label: 'Rate per sq ft', type: 'money', required: true },
    { name: 'plcBp', label: 'PLC (optional)', type: 'percent', hint: 'Leave blank to keep each unit’s PLC' },
    { name: 'unitType', label: 'Unit type', type: 'select', options: UNIT_TYPES, emptyLabel: 'All unit types' },
    { name: 'category', label: 'Category', type: 'select', options: PLOT_CATEGORIES, emptyLabel: 'All categories' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ];
  return (
    <MasterCrud<RateIndex>
      title="Rate & Price Indexes"
      description="Rate cards per project, unit type or category. Applying one reprices only unsold units."
      endpoint="/rate-indexes"
      queryKey="rate-indexes"
      entityLabel="rate index"
      sort="-effectiveFrom"
      fields={fields}
      defaults={{ effectiveFrom: todayInIndia() }}
      permissions={{ create: 'inventory.update', update: 'inventory.update', delete: 'inventory.update' }}
      columns={[
        { key: 'name', header: 'Name', sortKey: 'name', cell: (r) => <span className="font-medium">{r.name}</span> },
        { key: 'project', header: 'Project', cell: (r) => r.projectId?.name ?? '—' },
        {
          key: 'scope',
          header: 'Applies to',
          cell: (r) => [r.unitType && titleCase(r.unitType), r.category && titleCase(r.category), r.blockId?.name, r.phaseId?.name].filter(Boolean).join(' · ') || 'All units',
        },
        { key: 'rate', header: 'Rate / sq ft', sortKey: 'ratePaisePerSqft', align: 'right', cell: (r) => <span className="tabular">{formatINR(r.ratePaisePerSqft)}</span> },
        { key: 'from', header: 'Effective', sortKey: 'effectiveFrom', cell: (r) => formatDate(r.effectiveFrom.slice(0, 10)) },
        {
          key: 'applied',
          header: 'Last applied',
          hideOnMobile: true,
          cell: (r) => {
            const last = r.applications?.at(-1);
            return last ? `${formatDate(last.at)} · ${last.unitsRepriced} units` : <span className="text-muted-foreground">Never</span>;
          },
        },
      ]}
      rowActions={(r) => (
        <Can permission="inventory.update">
          <ApplyRateButton row={r} />
        </Can>
      )}
      transform={(p) => ({ ...p, ratePaisePerSqft: p.ratePaisePerSqft ?? 0 })}
      empty={<EmptyState title="No rate indexes yet" description="Create a rate card and apply it to reprice available units in one step." />}
    />
  );
}

