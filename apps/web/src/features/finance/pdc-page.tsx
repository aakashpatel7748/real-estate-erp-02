import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Ban, CheckCircle2, Landmark, Plus, Undo2, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { PDC_STATUSES, todayInIndia, type PdcStatus } from '@erp/shared';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { formatDate, formatINR, titleCase } from '@/lib/format';
import { newIdempotencyKey } from '@/lib/utils';
import { useListParams } from '@/hooks/use-list-params';
import { useProjectContext } from '@/hooks/use-project';
import { Can, useAuth } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Badge, Input, Select, Textarea, type BadgeVariant } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/overlays';
import { DataTable, type Column } from '@/components/data-table';
import { Field, PageHeader, StatCard } from '@/components/common';
import { EmptyState } from '@/components/states';
import { SearchInput } from '@/components/search-input';
import { AccountSelect, BookingPicker, type BookingOption } from '@/components/pickers';
import { MoneyInput, rupeeField, toPaise } from '@/components/money';

interface Pdc {
  id: string;
  chequeNumber: string;
  bankName: string;
  branch?: string;
  chequeDate: string;
  amountPaise: number;
  status: PdcStatus;
  depositedOn?: string;
  clearedOn?: string;
  bouncedOn?: string;
  bounceReason?: string;
  remarks?: string;
  customerId?: { id: string; name: string; phone: string };
  bookingId?: { id: string; bookingNumber: string };
  projectId?: { id: string; name: string };
  paymentId?: { id: string; number: string };
}
interface Summary {
  byStatus: Record<string, { count: number; amountPaise: number }>;
  dueForDeposit: { count: number; amountPaise: number };
}
const VARIANT: Record<PdcStatus, BadgeVariant> = {
  received: 'info',
  deposited: 'warning',
  clearing: 'warning',
  cleared: 'success',
  bounced: 'destructive',
  returned: 'muted',
  cancelled: 'muted',
};
type Action = 'deposit' | 'clear' | 'bounce' | 'return';

export function PdcPage() {
  const { can } = useAuth();
  const { projectId } = useProjectContext();
  const lp = useListParams({ sort: 'chequeDate' });
  const status = lp.filter('status');
  const due = lp.filter('due');
  const query = { ...lp.query, status, due, projectId: projectId ?? undefined };
  const q = useQuery({ queryKey: ['pdcs', query], queryFn: () => api.page<Pdc>('/pdcs', query) });
  const summary = useQuery({
    queryKey: ['pdcs', 'summary', projectId],
    queryFn: () => api.get<Summary>('/pdcs/summary', { projectId: projectId ?? undefined }),
  });
  const [creating, setCreating] = React.useState(false);
  const [action, setAction] = React.useState<{ pdc: Pdc; kind: Action } | null>(null);
  const today = todayInIndia();
  const columns: Column<Pdc>[] = [
    {
      key: 'cheque',
      header: 'Cheque',
      cell: (r) => (
        <div>
          <p className="font-medium">{r.chequeNumber}</p>
          <p className="text-xs text-muted-foreground">{r.bankName}</p>
        </div>
      ),
    },
    {
      key: 'date',
      header: 'Cheque date',
      sortKey: 'chequeDate',
      cell: (r) => (
        <span
          className={r.status === 'received' && r.chequeDate.slice(0, 10) <= today ? 'font-medium text-amber-700 dark:text-amber-400' : ''}
        >
          {formatDate(r.chequeDate.slice(0, 10))}
        </span>
      ),
    },
    {
      key: 'customer',
      header: 'Customer / booking',
      cell: (r) => (
        <div>
          <p>{r.customerId?.name}</p>
          {r.bookingId && (
            <Link
              to={`/post-sales/bookings/${r.bookingId.id}`}
              className="text-xs text-primary hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {r.bookingId.bookingNumber}
            </Link>
          )}
        </div>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      sortKey: 'amountPaise',
      align: 'right',
      cell: (r) => <span className="tabular">{formatINR(r.amountPaise)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      sortKey: 'status',
      cell: (r) => (
        <div>
          <Badge variant={VARIANT[r.status]}>{titleCase(r.status)}</Badge>
          {r.status === 'cleared' && r.paymentId && (
            <Link to={`/account/customer-receipts/${r.paymentId.id}`} className="ml-2 text-xs text-primary hover:underline">
              {r.paymentId.number}
            </Link>
          )}
          {r.status === 'bounced' && <p className="text-xs text-destructive">{r.bounceReason}</p>}
        </div>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (r) =>
        can('pdc.update') && (
          <div className="flex justify-end gap-1">
            {r.status === 'received' && (
              <Button size="sm" variant="outline" onClick={() => setAction({ pdc: r, kind: 'deposit' })}>
                <Landmark /> Deposit
              </Button>
            )}
            {(r.status === 'received' || r.status === 'deposited') && can('payments.create') && (
              <Button size="sm" onClick={() => setAction({ pdc: r, kind: 'clear' })}>
                <CheckCircle2 /> Cleared
              </Button>
            )}
            {(r.status === 'received' || r.status === 'deposited') && (
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => setAction({ pdc: r, kind: 'bounce' })}
                aria-label={`Mark ${r.chequeNumber} bounced`}
              >
                <Ban />
              </Button>
            )}
            {(r.status === 'received' || r.status === 'bounced') && (
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => setAction({ pdc: r, kind: 'return' })}
                aria-label={`Return ${r.chequeNumber} to customer`}
              >
                <Undo2 />
              </Button>
            )}
          </div>
        ),
    },
  ];
  const s = summary.data;
  const st = (k: string) => s?.byStatus[k] ?? { count: 0, amountPaise: 0 };
  return (
    <>
      <PageHeader
        title="Post-Dated Cheques (PDC)"
        description="Cheques collected in advance. The receipt is recorded only when a cheque clears."
        actions={
          <Can permission="pdc.create">
            <Button onClick={() => setCreating(true)}>
              <Plus /> Record cheque
            </Button>
          </Can>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Due for deposit"
          value={formatINR(s?.dueForDeposit.amountPaise ?? 0)}
          hint={
            <button type="button" className="cursor-pointer hover:underline" onClick={() => lp.setFilter('due', 'true')}>
              {s?.dueForDeposit.count ?? 0} cheques dated today or earlier
            </button>
          }
          icon={Wallet}
          tone={s?.dueForDeposit.count ? 'warning' : 'default'}
          loading={summary.isPending}
        />
        <StatCard
          label="In hand (not yet deposited)"
          value={formatINR(st('received').amountPaise)}
          hint={`${st('received').count} cheques`}
          loading={summary.isPending}
        />
        <StatCard
          label="Deposited, awaiting clearance"
          value={formatINR(st('deposited').amountPaise)}
          hint={`${st('deposited').count} cheques`}
          loading={summary.isPending}
        />
        <StatCard
          label="Bounced"
          value={formatINR(st('bounced').amountPaise)}
          hint={`${st('bounced').count} cheques`}
          tone={st('bounced').count ? 'danger' : 'default'}
          loading={summary.isPending}
        />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput value={lp.q} onChange={lp.setQ} placeholder="Cheque no. or bank" className="w-full sm:w-64" />
        <Select
          className="h-9 w-auto"
          value={status ?? ''}
          onChange={(e) => lp.setFilter('status', e.target.value || undefined)}
          aria-label="Status"
        >
          <option value="">All statuses</option>
          {PDC_STATUSES.filter((x) => x !== 'clearing').map((x) => (
            <option key={x} value={x}>
              {titleCase(x)}
            </option>
          ))}
        </Select>
        {due && (
          <Button size="sm" variant="ghost" onClick={() => lp.setFilter('due', undefined)}>
            Showing cheques due for deposit · clear
          </Button>
        )}
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
        empty={
          <EmptyState
            title="No cheques"
            description="Record post-dated cheques against bookings; deposit and clear them when they fall due."
          />
        }
      />
      <CreatePdcDialog open={creating} onOpenChange={setCreating} />
      <PdcActionDialog action={action} onClose={() => setAction(null)} />
    </>
  );
}

function CreatePdcDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [booking, setBooking] = React.useState<BookingOption | null>(null);
  const [rows, setRows] = React.useState([{ chequeNumber: '', chequeDate: '', amount: '' }]);
  const [bankName, setBankName] = React.useState('');
  const [branch, setBranch] = React.useState('');
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    if (open) {
      setBooking(null);
      setRows([{ chequeNumber: '', chequeDate: '', amount: '' }]);
      setBankName('');
      setBranch('');
      setErrors({});
    }
  }, [open]);
  const valid = rows.every(
    (r) => /^\d{6}$/.test(r.chequeNumber) && r.chequeDate && rupeeField('Amount', { min: 1 }).safeParse(r.amount).success,
  );
  const save = useMutation({
    mutationFn: async () => {
      // A series of cheques for one booking (e.g. monthly EMIs) is saved one by one.
      for (const r of rows) {
        await api.post('/pdcs', {
          bookingId: booking!.id,
          chequeNumber: r.chequeNumber,
          bankName,
          branch: branch || undefined,
          chequeDate: r.chequeDate,
          amountPaise: toPaise(r.amount),
        });
      }
      return rows.length;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ['pdcs'] });
      toast.success(`${n} cheque${n > 1 ? 's' : ''} recorded`);
      onOpenChange(false);
    },
    onError: (e) => {
      qc.invalidateQueries({ queryKey: ['pdcs'] });
      setErrors(fieldErrors(e));
      toast.error(errorMessage(e));
    },
  });
  const addNext = () => {
    const last = rows.at(-1)!;
    const nextNo = /^\d{6}$/.test(last.chequeNumber) ? String(Number(last.chequeNumber) + 1).padStart(6, '0') : '';
    let nextDate = '';
    if (last.chequeDate) {
      const d = new Date(`${last.chequeDate}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + 1);
      nextDate = d.toISOString().slice(0, 10);
    }
    setRows([...rows, { chequeNumber: nextNo, chequeDate: nextDate, amount: last.amount }]);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Record post-dated cheques" className="max-w-2xl">
        <Field label="Booking" htmlFor="pdc-booking" required>
          <BookingPicker id="pdc-booking" value={booking} onChange={setBooking} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Drawn on bank" htmlFor="pdc-bank" required error={errors.bankName}>
            <Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="SBI" />
          </Field>
          <Field label="Branch" htmlFor="pdc-branch">
            <Input value={branch} onChange={(e) => setBranch(e.target.value)} />
          </Field>
        </div>
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-xs font-medium text-muted-foreground">
            <span>Cheque no.</span>
            <span>Cheque date</span>
            <span>Amount</span>
            <span className="w-8" />
          </div>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
              <Input
                inputMode="numeric"
                maxLength={6}
                value={r.chequeNumber}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, chequeNumber: e.target.value.replace(/\D/g, '') } : x)))}
                aria-label="Cheque number"
              />
              <Input
                type="date"
                value={r.chequeDate}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, chequeDate: e.target.value } : x)))}
                aria-label="Cheque date"
              />
              <MoneyInput
                value={r.amount}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                aria-label="Amount"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={rows.length === 1}
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
                aria-label="Remove cheque"
              >
                ×
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addNext} disabled={rows.length >= 60}>
            <Plus /> Next cheque (+1 month)
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!booking || !bankName.trim() || !valid} onClick={() => save.mutate()}>
            Save {rows.length > 1 ? `${rows.length} cheques` : 'cheque'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PdcActionDialog({ action, onClose }: { action: { pdc: Pdc; kind: Action } | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [date, setDate] = React.useState(todayInIndia());
  const [reason, setReason] = React.useState('');
  const [accountId, setAccountId] = React.useState('');
  const key = React.useRef(newIdempotencyKey());
  React.useEffect(() => {
    if (action) {
      setDate(todayInIndia());
      setReason('');
      setAccountId('');
      key.current = newIdempotencyKey();
    }
  }, [action]);
  const run = useMutation({
    mutationFn: () => {
      const { pdc, kind } = action!;
      if (kind === 'deposit') return api.post(`/pdcs/${pdc.id}/deposit`, { depositedOn: date, depositAccountId: accountId || undefined });
      if (kind === 'clear') return api.post<{ receiptNumber: string }>(`/pdcs/${pdc.id}/clear`, { clearedOn: date }, key.current);
      if (kind === 'bounce') return api.post(`/pdcs/${pdc.id}/bounce`, { bouncedOn: date, reason });
      return api.post(`/pdcs/${pdc.id}/return`, { reason });
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['pdcs'] });
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['dues'] });
      toast.success(
        action?.kind === 'clear' ? `Cleared – receipt ${(r as { receiptNumber: string }).receiptNumber} recorded` : 'Cheque updated',
      );
      onClose();
    },
    onError: (e) => {
      key.current = newIdempotencyKey();
      toast.error(errorMessage(e));
    },
  });
  const titles: Record<Action, string> = {
    deposit: 'Deposit cheque',
    clear: 'Mark cheque cleared',
    bounce: 'Mark cheque bounced',
    return: 'Return cheque to customer',
  };
  const needsReason = action?.kind === 'bounce' || action?.kind === 'return';
  return (
    <Dialog open={!!action} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={action ? titles[action.kind] : ''}
        description={
          action
            ? `Cheque ${action.pdc.chequeNumber} · ${action.pdc.bankName} · ${formatINR(action.pdc.amountPaise)} · ${action.pdc.customerId?.name ?? ''}`
            : undefined
        }
      >
        {action?.kind === 'clear' && (
          <p className="text-sm text-muted-foreground">A receipt is recorded against the booking and allocated to its oldest dues.</p>
        )}
        {action?.kind !== 'return' && (
          <Field
            label={action?.kind === 'deposit' ? 'Deposited on' : action?.kind === 'clear' ? 'Cleared on' : 'Bounced on'}
            htmlFor="pa-date"
            required
          >
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        )}
        {action?.kind === 'deposit' && can('accounting.read') && (
          <Field label="Deposited into" htmlFor="pa-acc" hint="Defaults to the main bank account">
            <AccountSelect id="pa-acc" value={accountId} onChange={setAccountId} cashBankOnly placeholder="Default bank account" />
          </Field>
        )}
        {needsReason && (
          <Field label="Reason" htmlFor="pa-reason" required>
            <Textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={action?.kind === 'bounce' ? 'Insufficient funds' : ''}
            />
          </Field>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={action?.kind === 'bounce' ? 'destructive' : 'default'}
            loading={run.isPending}
            disabled={needsReason && !reason.trim()}
            onClick={() => run.mutate()}
          >
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
