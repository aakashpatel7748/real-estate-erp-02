import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { BookPlus, Plus, Trash2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { ACCOUNT_TYPES, financialYear, todayInIndia, type AccountType } from '@erp/shared';
import { api, errorMessage } from '@/lib/api';
import { formatDate, formatDateTime, formatINR, titleCase } from '@/lib/format';
import { useListParams } from '@/hooks/use-list-params';
import { useProjectContext } from '@/hooks/use-project';
import { Can, useAuth } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  Select,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/primitives';
import { ConfirmDialog, Dialog, DialogContent, DialogFooter, Sheet, SheetContent } from '@/components/ui/overlays';
import { DataTable, type Column } from '@/components/data-table';
import { Field, PageHeader, StatusBadge } from '@/components/common';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/states';
import { SearchInput } from '@/components/search-input';
import { MoneyInput, toPaise } from '@/components/money';

interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  systemKey?: string;
  isBank: boolean;
  isActive: boolean;
  description?: string;
}
const CONTROL = ['customer_receivable', 'customer_advance', 'refund_payable'];

function useAccounts() {
  return useQuery({ queryKey: ['accounts'], queryFn: () => api.get<Account[]>('/accounting/accounts') });
}

export function AccountingPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'journal';
  return (
    <>
      <PageHeader title="Journal Voucher" description="Double-entry books generated from bookings, receipts and manual vouchers" />
      <Tabs value={tab} onValueChange={(t) => setParams({ tab: t }, { replace: true })}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="journal">Journal</TabsTrigger>
          <TabsTrigger value="accounts">Chart of accounts</TabsTrigger>
          <TabsTrigger value="trial">Trial balance</TabsTrigger>
          <TabsTrigger value="pl">Profit & loss</TabsTrigger>
          <TabsTrigger value="bs">Balance sheet</TabsTrigger>
          <TabsTrigger value="ledger">Ledger</TabsTrigger>
        </TabsList>
        <TabsContent value="journal">
          <JournalTab />
        </TabsContent>
        <TabsContent value="accounts">
          <AccountsTab />
        </TabsContent>
        <TabsContent value="trial">
          <TrialBalanceTab />
        </TabsContent>
        <TabsContent value="pl">
          <ProfitLossTab />
        </TabsContent>
        <TabsContent value="bs">
          <BalanceSheetTab />
        </TabsContent>
        <TabsContent value="ledger">
          <LedgerTab />
        </TabsContent>
      </Tabs>
    </>
  );
}

interface Entry {
  id: string;
  entryNumber: string;
  voucherType: string;
  date: string;
  narration: string;
  reference?: string;
  totalPaise: number;
  source?: { type?: string; id?: string };
  reversalOf?: string;
  reversedBy?: string;
  reversalReason?: string;
  createdAt: string;
  postedBy?: { name: string };
  lines: {
    accountId: { id: string; code: string; name: string } | null;
    debitPaise: number;
    creditPaise: number;
    narration?: string;
    customerId?: { name: string };
  }[];
}

function JournalTab() {
  const lp = useListParams();
  const navigate = useNavigate();
  const { projectId } = useProjectContext();
  const [creating, setCreating] = React.useState(false);
  const filters = { voucherType: lp.filter('voucherType'), from: lp.filter('from'), to: lp.filter('to') };
  const q = useQuery({
    queryKey: ['journal', projectId, lp.query, filters],
    queryFn: () => api.page<Entry>('/accounting/journal-entries', { ...lp.query, ...filters, projectId: projectId ?? undefined }),
    placeholderData: (p) => p,
  });
  const columns: Column<Entry>[] = [
    { key: 'no', header: 'Voucher', cell: (e) => <span className="font-medium">{e.entryNumber}</span> },
    { key: 'date', header: 'Date', cell: (e) => formatDate(e.date.slice(0, 10)) },
    { key: 'type', header: 'Type', cell: (e) => titleCase(e.voucherType), hideOnMobile: true },
    { key: 'narration', header: 'Narration', cell: (e) => <span className="line-clamp-1">{e.narration}</span>, className: 'max-w-md' },
    { key: 'amount', header: 'Amount', align: 'right', cell: (e) => formatINR(e.totalPaise) },
    {
      key: 'status',
      header: '',
      cell: (e) =>
        e.reversedBy ? (
          <StatusBadge status="reversed" />
        ) : e.reversalOf ? (
          <span className="text-xs text-muted-foreground">reversal</span>
        ) : null,
    },
  ];
  return (
    <>
      <div className="mb-4 flex flex-col gap-2 lg:flex-row">
        <SearchInput value={lp.q} onChange={lp.setQ} placeholder="Voucher no., narration or reference" />
        <Select
          className="lg:w-40"
          value={filters.voucherType ?? ''}
          onChange={(e) => lp.setFilter('voucherType', e.target.value || undefined)}
          aria-label="Voucher type"
        >
          <option value="">All types</option>
          {['journal', 'sales', 'receipt', 'payment', 'contra', 'reversal'].map((t) => (
            <option key={t} value={t}>
              {titleCase(t)}
            </option>
          ))}
        </Select>
        <Input
          type="date"
          className="lg:w-40"
          value={filters.from ?? ''}
          onChange={(e) => lp.setFilter('from', e.target.value || undefined)}
          aria-label="From"
        />
        <Input
          type="date"
          className="lg:w-40"
          value={filters.to ?? ''}
          onChange={(e) => lp.setFilter('to', e.target.value || undefined)}
          aria-label="To"
        />
        <Can permission="accounting.create">
          <Button className="lg:ml-auto" onClick={() => setCreating(true)}>
            <BookPlus /> New voucher
          </Button>
        </Can>
      </div>
      <DataTable
        columns={columns}
        rows={q.data?.items}
        rowKey={(e) => e.id}
        loading={q.isPending}
        error={q.error}
        onRetry={() => q.refetch()}
        meta={q.data?.meta}
        onPageChange={lp.setPage}
        pageSize={lp.pageSize}
        onPageSizeChange={lp.setPageSize}
        onRowClick={(e) => navigate(`/account/journal-voucher/entries/${e.id}`)}
        empty={<EmptyState title="No entries" />}
      />
      <VoucherSheet open={creating} onOpenChange={setCreating} />
    </>
  );
}

function VoucherSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const accounts = useAccounts();
  const { projects, projectId } = useProjectContext();
  const { context } = useAuth();
  const restricted = context?.activeCompany?.projectAccess.mode === 'restricted';
  const [date, setDate] = React.useState(todayInIndia());
  const [narration, setNarration] = React.useState('');
  const [reference, setReference] = React.useState('');
  const [project, setProject] = React.useState(projectId ?? '');
  const [lines, setLines] = React.useState([
    { accountId: '', debit: '', credit: '' },
    { accountId: '', debit: '', credit: '' },
  ]);
  const usable = (accounts.data ?? []).filter((a) => a.isActive && !CONTROL.includes(a.systemKey ?? ''));

  let totals = { debit: 0, credit: 0 };
  let parseError = '';
  try {
    totals = lines.reduce((t, l) => ({ debit: t.debit + toPaise(l.debit), credit: t.credit + toPaise(l.credit) }), { debit: 0, credit: 0 });
  } catch {
    parseError = 'Check the amounts';
  }
  const balanced = !parseError && totals.debit === totals.credit && totals.debit > 0;

  const save = useMutation({
    mutationFn: () =>
      api.post('/accounting/journal-entries', {
        date,
        narration,
        reference: reference || undefined,
        projectId: project || undefined,
        lines: lines
          .filter((l) => l.accountId && (l.debit || l.credit))
          .map((l) => ({ accountId: l.accountId, debitPaise: toPaise(l.debit), creditPaise: toPaise(l.credit) })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['journal'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      toast.success('Voucher posted');
      onOpenChange(false);
      setNarration('');
      setReference('');
      setLines([
        { accountId: '', debit: '', credit: '' },
        { accountId: '', debit: '', credit: '' },
      ]);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title="New journal voucher"
        description="Posted vouchers cannot be edited; correct mistakes with a reversal. Customer control accounts are posted only through bookings and receipts."
        className="sm:max-w-3xl"
        footer={
          <>
            <span className={`mr-auto self-center text-sm tabular ${balanced ? 'text-green-700' : 'text-destructive'}`}>
              Dr {formatINR(totals.debit)} · Cr {formatINR(totals.credit)} {balanced ? '✓ balanced' : '· not balanced'}
            </span>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              disabled={!balanced || !narration.trim() || (restricted && !project)}
              loading={save.isPending}
              onClick={() => save.mutate()}
            >
              Post voucher
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Date" htmlFor="v-date" required>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Project" htmlFor="v-project" hint={restricted ? 'Required for your role' : 'Optional'}>
            <Select value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="">Company-wide</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reference" htmlFor="v-ref">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field label="Narration" htmlFor="v-narration" required className="sm:col-span-3">
            <Input value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="e.g. Office rent for October" />
          </Field>
        </div>
        <div className="mt-6 space-y-2">
          <div className="hidden grid-cols-[1fr_150px_150px_auto] gap-2 text-xs font-semibold uppercase text-muted-foreground sm:grid">
            <span>Account</span>
            <span>Debit</span>
            <span>Credit</span>
            <span className="w-9" />
          </div>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_150px_150px_auto]">
              <Select
                className="col-span-2 sm:col-span-1"
                value={l.accountId}
                onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, accountId: e.target.value } : x)))}
                aria-label={`Line ${i + 1} account`}
              >
                <option value="">Choose account…</option>
                {ACCOUNT_TYPES.map((t) => (
                  <optgroup key={t} label={titleCase(t)}>
                    {usable
                      .filter((a) => a.type === t)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} · {a.name}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </Select>
              <MoneyInput
                value={l.debit}
                onChange={(e) =>
                  setLines((ls) =>
                    ls.map((x, j) => (j === i ? { ...x, debit: e.target.value, credit: e.target.value ? '' : x.credit } : x)),
                  )
                }
                aria-label={`Line ${i + 1} debit`}
              />
              <MoneyInput
                value={l.credit}
                onChange={(e) =>
                  setLines((ls) => ls.map((x, j) => (j === i ? { ...x, credit: e.target.value, debit: e.target.value ? '' : x.debit } : x)))
                }
                aria-label={`Line ${i + 1} credit`}
              />
              <Button
                variant="ghost"
                size="icon"
                disabled={lines.length <= 2}
                onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                aria-label="Remove line"
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLines((ls) => [...ls, { accountId: '', debit: '', credit: '' }])}
            disabled={lines.length >= 50}
          >
            <Plus /> Add line
          </Button>
          {parseError && <p className="text-sm text-destructive">{parseError}</p>}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function JournalEntryPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [reversing, setReversing] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const q = useQuery({ queryKey: ['journal', 'entry', id], queryFn: () => api.get<Entry>(`/accounting/journal-entries/${id}`) });
  const reverse = useMutation({
    mutationFn: () => api.post<{ id: string }>(`/accounting/journal-entries/${id}/reverse`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['journal'] });
      setReversing(false);
      toast.success('Reversal posted');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const e = q.data;
  const canReverse = e.source?.type === 'manual' && !e.reversedBy && !e.reversalOf;
  const sourceLink =
    e.source?.type === 'booking'
      ? `/post-sales/bookings/${e.source.id}`
      : e.source?.type === 'payment' || e.source?.type === 'refund'
        ? `/account/customer-receipts/${e.source.id}`
        : null;
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Journal voucher', to: '/account/journal-voucher' }, { label: e.entryNumber }]}
        title={e.entryNumber}
        description={`${titleCase(e.voucherType)} · ${formatDate(e.date.slice(0, 10))} · posted ${formatDateTime(e.createdAt)}${e.postedBy ? ` by ${e.postedBy.name}` : ''}`}
        actions={
          <Can permission="accounting.reverse">
            {canReverse && (
              <Button variant="outline" onClick={() => setReversing(true)}>
                <Undo2 /> Reverse
              </Button>
            )}
          </Can>
        }
      />
      <Card>
        <CardContent className="space-y-4 pt-5">
          <p className="text-sm">{e.narration}</p>
          {e.reversedBy && (
            <p className="text-sm text-destructive">
              Reversed ({e.reversalReason}).{' '}
              <Link to={`/account/journal-voucher/entries/${e.reversedBy}`} className="underline">
                View reversal
              </Link>
            </p>
          )}
          {e.reversalOf && (
            <p className="text-sm text-muted-foreground">
              Reversal of{' '}
              <Link to={`/account/journal-voucher/entries/${e.reversalOf}`} className="underline">
                original entry
              </Link>
            </p>
          )}
          {sourceLink && (
            <p className="text-sm">
              Source:{' '}
              <Link to={sourceLink} className="text-primary underline">
                {titleCase(e.source!.type!)}
              </Link>
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3">Account</th>
                  <th className="py-2 pr-3">Particulars</th>
                  <th className="py-2 pr-3 text-right">Debit</th>
                  <th className="py-2 text-right">Credit</th>
                </tr>
              </thead>
              <tbody>
                {e.lines.map((l, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      {l.accountId?.code} · {l.accountId?.name}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">{[l.narration, l.customerId?.name].filter(Boolean).join(' · ')}</td>
                    <td className="py-2 pr-3 text-right tabular">{l.debitPaise ? formatINR(l.debitPaise) : ''}</td>
                    <td className="py-2 text-right tabular">{l.creditPaise ? formatINR(l.creditPaise) : ''}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td colSpan={2} className="py-2">
                    Total
                  </td>
                  <td className="py-2 pr-3 text-right tabular">{formatINR(e.totalPaise)}</td>
                  <td className="py-2 text-right tabular">{formatINR(e.totalPaise)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={reversing}
        onOpenChange={setReversing}
        title="Post a reversal?"
        description="A mirror-image voucher is posted today and linked to this one. The original stays on record."
        confirmLabel="Post reversal"
        loading={reverse.isPending}
        onConfirm={() => (reason.trim() ? reverse.mutate() : toast.error('Please enter a reason'))}
      >
        <Field label="Reason" htmlFor="je-reason" required>
          <Input value={reason} onChange={(ev) => setReason(ev.target.value)} />
        </Field>
      </ConfirmDialog>
    </>
  );
}

const accountForm = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[0-9A-Z-]{1,12}$/, 'Digits, capitals and -'),
  name: z.string().trim().min(1, 'Name is required').max(120),
  type: z.enum(ACCOUNT_TYPES),
  isBank: z.boolean(),
  description: z.string().max(300).optional(),
});

function AccountsTab() {
  const qc = useQueryClient();
  const accounts = useAccounts();
  const navigate = useNavigate();
  const [creating, setCreating] = React.useState(false);
  const form = useForm<z.infer<typeof accountForm>>({
    resolver: zodResolver(accountForm),
    defaultValues: { type: 'expense', isBank: false },
  });
  const create = useMutation({
    mutationFn: (v: z.infer<typeof accountForm>) => api.post('/accounting/accounts', { ...v, description: v.description || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      setCreating(false);
      form.reset({ type: 'expense', isBank: false });
      toast.success('Account created');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const toggle = useMutation({
    mutationFn: (a: Account) => api.patch(`/accounting/accounts/${a.id}`, { isActive: !a.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (accounts.isPending) return <PageSkeleton />;
  if (accounts.isError) return <ErrorState error={accounts.error} onRetry={() => accounts.refetch()} />;
  return (
    <>
      <div className="mb-4 flex justify-end">
        <Can permission="accounting.manageAccounts">
          <Button onClick={() => setCreating(true)}>
            <Plus /> New account
          </Button>
        </Can>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {ACCOUNT_TYPES.map((t) => (
          <Card key={t}>
            <CardHeader>
              <CardTitle>{titleCase(t)}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y text-sm">
                {accounts.data
                  .filter((a) => a.type === t)
                  .map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                      <button
                        type="button"
                        className="text-left hover:underline cursor-pointer"
                        onClick={() => navigate(`/account/journal-voucher?tab=ledger&account=${a.id}`)}
                      >
                        <span className="text-muted-foreground">{a.code}</span> {a.name}
                        {a.systemKey && <span className="ml-2 text-xs text-muted-foreground">system</span>}
                        {CONTROL.includes(a.systemKey ?? '') && <span className="ml-1 text-xs text-amber-700">control</span>}
                      </button>
                      <Can permission="accounting.manageAccounts">
                        {!a.systemKey && (
                          <Button variant="ghost" size="sm" onClick={() => toggle.mutate(a)}>
                            {a.isActive ? 'Deactivate' : 'Activate'}
                          </Button>
                        )}
                      </Can>
                    </li>
                  ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent title="New account">
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit((v) => create.mutate(v))} noValidate>
            <Field label="Code" htmlFor="ac-code" error={form.formState.errors.code?.message} required>
              <Input {...form.register('code')} placeholder="5300" />
            </Field>
            <Field label="Type" htmlFor="ac-type">
              <Select {...form.register('type')}>
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {titleCase(t)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Name" htmlFor="ac-name" error={form.formState.errors.name?.message} required className="sm:col-span-2">
              <Input {...form.register('name')} placeholder="e.g. HDFC Current A/c, Site Electricity" />
            </Field>
            <div className="flex items-center gap-2 sm:col-span-2">
              <Checkbox id="ac-bank" checked={form.watch('isBank')} onCheckedChange={(c) => form.setValue('isBank', c === true)} />
              <Label htmlFor="ac-bank">This is a bank account (receipts can be deposited here)</Label>
            </div>
            <DialogFooter className="sm:col-span-2">
              <Button type="submit" loading={create.isPending}>
                Create account
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function useReport<T>(path: string, query: Record<string, string | undefined>) {
  const { projectId } = useProjectContext();
  return useQuery({
    queryKey: ['reports', path, query, projectId],
    queryFn: () => api.get<T>(path, { ...query, projectId: projectId ?? undefined }),
  });
}

function ReportShell({ children, controls }: { children: React.ReactNode; controls: React.ReactNode }) {
  const { project } = useProjectContext();
  return (
    <Card>
      <CardHeader className="flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <p className="text-sm text-muted-foreground">{project ? `Project: ${project.name}` : 'Company-wide'}</p>
        <div className="flex flex-wrap items-end gap-2">{controls}</div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

const fyStart = () => `${financialYear(todayInIndia()).slice(0, 4)}-04-01`;

function TrialBalanceTab() {
  const [asOf, setAsOf] = React.useState(todayInIndia());
  const q = useReport<{
    rows: { accountId: string; code: string; name: string; type: string; debitPaise: number; creditPaise: number }[];
    totals: { debitPaise: number; creditPaise: number };
    balanced: boolean;
  }>('/accounting/reports/trial-balance', { asOf });
  return (
    <ReportShell
      controls={<Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} aria-label="As of" className="w-40" />}
    >
      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="py-2">Account</th>
              <th className="py-2 text-right">Debit</th>
              <th className="py-2 text-right">Credit</th>
            </tr>
          </thead>
          <tbody>
            {q.data.rows.map((r) => (
              <tr key={r.accountId} className="border-b last:border-0">
                <td className="py-2">
                  <span className="text-muted-foreground">{r.code}</span> {r.name}
                </td>
                <td className="py-2 text-right tabular">{r.debitPaise ? formatINR(r.debitPaise) : ''}</td>
                <td className="py-2 text-right tabular">{r.creditPaise ? formatINR(r.creditPaise) : ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="py-2">
                Total{' '}
                {q.data.balanced ? (
                  <span className="ml-2 text-xs font-normal text-green-700">balanced</span>
                ) : (
                  <span className="ml-2 text-xs text-destructive">not balanced</span>
                )}
              </td>
              <td className="py-2 text-right tabular">{formatINR(q.data.totals.debitPaise)}</td>
              <td className="py-2 text-right tabular">{formatINR(q.data.totals.creditPaise)}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </ReportShell>
  );
}

type Line = { accountId: string; code: string; name: string; amountPaise: number };
function Section({ title, rows, total }: { title: string; rows: Line[]; total: number }) {
  return (
    <div className="mb-6">
      <p className="mb-1 text-sm font-semibold">{title}</p>
      <table className="w-full text-sm">
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td className="py-1.5 text-muted-foreground">—</td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.accountId} className="border-b last:border-0">
              <td className="py-1.5">
                <span className="text-muted-foreground">{r.code}</span> {r.name}
              </td>
              <td className="py-1.5 text-right tabular">{formatINR(r.amountPaise)}</td>
            </tr>
          ))}
          <tr className="font-medium">
            <td className="py-1.5">Total {title.toLowerCase()}</td>
            <td className="py-1.5 text-right tabular">{formatINR(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ProfitLossTab() {
  const [from, setFrom] = React.useState(fyStart());
  const [to, setTo] = React.useState(todayInIndia());
  const q = useReport<{ income: Line[]; expenses: Line[]; totalIncomePaise: number; totalExpensesPaise: number; netProfitPaise: number }>(
    '/accounting/reports/profit-loss',
    { from, to },
  );
  return (
    <ReportShell
      controls={
        <>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" className="w-40" />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" className="w-40" />
        </>
      }
    >
      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <Section title="Income" rows={q.data.income} total={q.data.totalIncomePaise} />
          <Section title="Expenses" rows={q.data.expenses} total={q.data.totalExpensesPaise} />
          <div className="flex justify-between border-t pt-3 text-base font-semibold">
            <span>{q.data.netProfitPaise >= 0 ? 'Net profit' : 'Net loss'}</span>
            <span className="tabular">{formatINR(Math.abs(q.data.netProfitPaise))}</span>
          </div>
        </>
      )}
    </ReportShell>
  );
}

function BalanceSheetTab() {
  const [asOf, setAsOf] = React.useState(todayInIndia());
  const q = useReport<{
    assets: Line[];
    liabilities: Line[];
    equity: Line[];
    retainedEarningsPaise: number;
    totalAssetsPaise: number;
    totalLiabilitiesPaise: number;
    totalEquityPaise: number;
    balanced: boolean;
  }>('/accounting/reports/balance-sheet', { asOf });
  return (
    <ReportShell
      controls={<Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} aria-label="As of" className="w-40" />}
    >
      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <Section title="Assets" rows={q.data.assets} total={q.data.totalAssetsPaise} />
          </div>
          <div>
            <Section title="Liabilities" rows={q.data.liabilities} total={q.data.totalLiabilitiesPaise} />
            <Section
              title="Equity"
              rows={[
                ...q.data.equity,
                { accountId: 're', code: '', name: 'Retained earnings (current)', amountPaise: q.data.retainedEarningsPaise },
              ]}
              total={q.data.totalEquityPaise}
            />
            <p className={`text-sm ${q.data.balanced ? 'text-green-700' : 'text-destructive'}`}>
              Liabilities + equity = {formatINR(q.data.totalLiabilitiesPaise + q.data.totalEquityPaise)}{' '}
              {q.data.balanced ? '✓' : '(does not match assets)'}
            </p>
          </div>
        </div>
      )}
    </ReportShell>
  );
}

function LedgerTab() {
  const [params, setParams] = useSearchParams();
  const accounts = useAccounts();
  const accountId = params.get('account') ?? '';
  const [from, setFrom] = React.useState(fyStart());
  const [to, setTo] = React.useState(todayInIndia());
  const { projectId } = useProjectContext();
  const q = useQuery({
    queryKey: ['reports', 'ledger', accountId, from, to, projectId],
    queryFn: () =>
      api.get<{
        openingBalancePaise: number;
        closingBalancePaise: number;
        entries: {
          id: string;
          entryNumber: string;
          date: string;
          narration: string;
          debitPaise: number;
          creditPaise: number;
          balancePaise: number;
        }[];
      }>(`/accounting/reports/ledger/${accountId}`, { from, to, projectId: projectId ?? undefined }),
    enabled: Boolean(accountId),
  });
  return (
    <ReportShell
      controls={
        <>
          <Select
            className="w-64"
            value={accountId}
            onChange={(e) =>
              setParams(
                (p) => {
                  const n = new URLSearchParams(p);
                  n.set('account', e.target.value);
                  return n;
                },
                { replace: true },
              )
            }
            aria-label="Account"
          >
            <option value="">Choose account…</option>
            {accounts.data?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
              </option>
            ))}
          </Select>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" className="w-40" />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" className="w-40" />
        </>
      }
    >
      {!accountId ? (
        <EmptyState title="Choose an account to see its ledger" />
      ) : q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3">Voucher</th>
                <th className="py-2 pr-3">Particulars</th>
                <th className="py-2 pr-3 text-right">Debit</th>
                <th className="py-2 pr-3 text-right">Credit</th>
                <th className="py-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b bg-muted/40">
                <td colSpan={5} className="py-2 pr-3 font-medium">
                  Opening balance
                </td>
                <td className="py-2 text-right tabular">{formatINR(q.data.openingBalancePaise)}</td>
              </tr>
              {q.data.entries.map((e, i) => (
                <tr key={`${e.id}-${i}`} className="border-b last:border-0">
                  <td className="py-2 pr-3 whitespace-nowrap">{formatDate(e.date.slice(0, 10))}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <Link to={`/account/journal-voucher/entries/${e.id}`} className="text-primary hover:underline">
                      {e.entryNumber}
                    </Link>
                  </td>
                  <td className="py-2 pr-3">{e.narration}</td>
                  <td className="py-2 pr-3 text-right tabular">{e.debitPaise ? formatINR(e.debitPaise) : ''}</td>
                  <td className="py-2 pr-3 text-right tabular">{e.creditPaise ? formatINR(e.creditPaise) : ''}</td>
                  <td className="py-2 text-right tabular">{formatINR(e.balancePaise)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td colSpan={5} className="py-2">
                  Closing balance
                </td>
                <td className="py-2 text-right tabular">{formatINR(q.data.closingBalancePaise)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </ReportShell>
  );
}
