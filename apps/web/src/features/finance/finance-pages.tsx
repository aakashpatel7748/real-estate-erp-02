import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { MinusCircle, Plus, PlusCircle, Receipt, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { ADJUSTMENT_REASONS, GST_RATES_BP, PAYMENT_MODES, todayInIndia } from '@erp/shared';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { formatDate, formatINR, titleCase } from '@/lib/format';
import { newIdempotencyKey } from '@/lib/utils';
import { useListParams } from '@/hooks/use-list-params';
import { useProjectContext } from '@/hooks/use-project';
import { Can, useAuth } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardHeader, CardTitle, Checkbox, Input, Label, Select, Textarea } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/overlays';
import { DataTable, type Column } from '@/components/data-table';
import { Field, PageHeader, StatCard } from '@/components/common';
import { EmptyState } from '@/components/states';
import { SearchInput } from '@/components/search-input';
import { AccountSelect, BookingPicker, ProjectSelect, type BookingOption } from '@/components/pickers';
import { MoneyInput, rupeeField, toPaise } from '@/components/money';

const dateInput = 'h-9';

function DateRange({ lp }: { lp: ReturnType<typeof useListParams> }) {
  return (
    <>
      <Input
        type="date"
        className={`${dateInput} w-auto`}
        value={lp.filter('from') ?? ''}
        onChange={(e) => lp.setFilter('from', e.target.value || undefined)}
        aria-label="From date"
      />
      <span className="text-sm text-muted-foreground">to</span>
      <Input
        type="date"
        className={`${dateInput} w-auto`}
        value={lp.filter('to') ?? ''}
        onChange={(e) => lp.setFilter('to', e.target.value || undefined)}
        aria-label="To date"
      />
    </>
  );
}

// =====================================================================
// Vendor & contractor payments
// =====================================================================

interface VendorPayment {
  id: string;
  number: string;
  date: string;
  amountPaise: number;
  mode: string;
  reference?: string;
  remarks?: string;
  vendorId?: { id: string; name: string; category: string };
  projectId?: { id: string; name: string };
  accountId?: { code: string; name: string };
}
interface VendorOption {
  id: string;
  name: string;
  payablePaise?: number;
}

function useVendors(enabled = true) {
  return useQuery({
    queryKey: ['vendors', 'options', 'payables'],
    queryFn: () => api.page<VendorOption>('/vendors', { pageSize: 100 }),
    enabled,
    select: (r) => r.items,
  });
}

export function VendorPaymentsPage() {
  const { projectId } = useProjectContext();
  const lp = useListParams({ sort: '-date' });
  const vendorId = lp.filter('vendorId');
  const query = { ...lp.query, vendorId, from: lp.filter('from'), to: lp.filter('to'), projectId: projectId ?? undefined };
  // The filtered total comes back in a header.
  const q = useQuery({
    queryKey: ['vendor-payments', query],
    queryFn: () => api.pageWithHeaders<VendorPayment>('/vendor-payments', query),
  });
  const total = Number(q.data?.headers.get('x-total-amount') ?? 0);
  const vendors = useVendors();
  const [paying, setPaying] = React.useState(false);
  const payable = (vendors.data ?? []).reduce((s, v) => s + Math.max(v.payablePaise ?? 0, 0), 0);
  const columns: Column<VendorPayment>[] = [
    { key: 'number', header: 'Voucher', sortKey: 'number', cell: (r) => <span className="font-medium">{r.number}</span> },
    { key: 'date', header: 'Date', sortKey: 'date', cell: (r) => formatDate(r.date.slice(0, 10)) },
    {
      key: 'vendor',
      header: 'Vendor / contractor',
      cell: (r) =>
        r.vendorId ? (
          <Link to={`/master/vendors-contractors/${r.vendorId.id}`} className="text-primary hover:underline">
            {r.vendorId.name}
          </Link>
        ) : (
          '—'
        ),
    },
    { key: 'project', header: 'Project', hideOnMobile: true, cell: (r) => r.projectId?.name ?? '—' },
    { key: 'mode', header: 'Mode', cell: (r) => `${r.mode.toUpperCase()}${r.reference ? ` · ${r.reference}` : ''}` },
    { key: 'account', header: 'Paid from', hideOnMobile: true, cell: (r) => r.accountId?.name ?? '—' },
    {
      key: 'amount',
      header: 'Amount',
      sortKey: 'amountPaise',
      align: 'right',
      cell: (r) => <span className="tabular">{formatINR(r.amountPaise)}</span>,
    },
  ];
  return (
    <>
      <PageHeader
        title="Vendor & Contractor Payments"
        description="Payments against vendor bills. Each payment is capped at what the vendor is owed."
        actions={
          <Can permission="vendors.pay">
            <Button onClick={() => setPaying(true)}>
              <Plus /> Record payment
            </Button>
          </Can>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <StatCard label="Paid (filtered)" value={formatINR(total)} icon={Receipt} loading={q.isPending} />
        <StatCard
          label="Owed to vendors now"
          value={formatINR(payable)}
          tone={payable ? 'warning' : 'default'}
          loading={vendors.isPending}
        />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput value={lp.q} onChange={lp.setQ} placeholder="Voucher or reference" className="w-full sm:w-60" />
        <Select
          className="h-9 w-auto"
          value={vendorId ?? ''}
          onChange={(e) => lp.setFilter('vendorId', e.target.value || undefined)}
          aria-label="Vendor"
        >
          <option value="">All vendors</option>
          {vendors.data?.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </Select>
        <DateRange lp={lp} />
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
        empty={<EmptyState title="No payments" description="Record vendor bills under Vendors & Contractors, then pay them here." />}
      />
      <VendorPaymentDialog open={paying} onOpenChange={setPaying} />
    </>
  );
}

function VendorPaymentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const vendors = useVendors(open);
  const [vendorId, setVendorId] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [paidOn, setPaidOn] = React.useState(todayInIndia());
  const [mode, setMode] = React.useState('neft');
  const [reference, setReference] = React.useState('');
  const [projectId, setProjectId] = React.useState('');
  const [fromAccountId, setFromAccountId] = React.useState('');
  const key = React.useRef(newIdempotencyKey());
  React.useEffect(() => {
    if (open) {
      setVendorId('');
      setAmount('');
      setPaidOn(todayInIndia());
      setMode('neft');
      setReference('');
      setProjectId('');
      setFromAccountId('');
      key.current = newIdempotencyKey();
    }
  }, [open]);
  const vendor = vendors.data?.find((v) => v.id === vendorId);
  const amountOk = rupeeField('Amount', { min: 1 }).safeParse(amount).success;
  const save = useMutation({
    mutationFn: () =>
      api.post(
        `/vendors/${vendorId}/payments`,
        {
          amountPaise: toPaise(amount),
          paidOn,
          mode,
          reference: reference || undefined,
          projectId: projectId || undefined,
          fromAccountId: fromAccountId || undefined,
        },
        key.current,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vendor-payments'] });
      qc.invalidateQueries({ queryKey: ['vendors'] });
      toast.success('Payment recorded');
      onOpenChange(false);
    },
    onError: (e) => {
      key.current = newIdempotencyKey();
      toast.error(errorMessage(e));
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Pay a vendor / contractor">
        <Field label="Vendor" htmlFor="vp-vendor" required hint={vendor ? `Owed ${formatINR(vendor.payablePaise ?? 0)}` : undefined}>
          <Select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">Choose…</option>
            {vendors.data?.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} · owed {formatINR(v.payablePaise ?? 0, { decimals: false })}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount" htmlFor="vp-amt" required error={amount && !amountOk ? 'Enter an amount' : undefined}>
            <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Paid on" htmlFor="vp-date" required>
            <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </Field>
          <Field label="Mode" htmlFor="vp-mode">
            <Select value={mode} onChange={(e) => setMode(e.target.value)}>
              {PAYMENT_MODES.map((m) => (
                <option key={m} value={m}>
                  {m.toUpperCase()}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reference / UTR" htmlFor="vp-ref">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field label="Project" htmlFor="vp-project">
            <ProjectSelect value={projectId} onChange={setProjectId} allowAll allLabel="—" />
          </Field>
          {can('accounting.read') && (
            <Field label="Paid from" htmlFor="vp-acc">
              <AccountSelect value={fromAccountId} onChange={setFromAccountId} cashBankOnly placeholder="Default by mode" />
            </Field>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!vendorId || !amountOk} onClick={() => save.mutate()}>
            Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =====================================================================
// Ledger adjustments
// =====================================================================

interface Adjustment {
  id: string;
  number: string;
  type: 'credit' | 'debit';
  reason: string;
  amountPaise: number;
  date: string;
  narration?: string;
  status: 'posted' | 'reversed';
  reversal?: { reason: string };
  bookingId?: { id: string; bookingNumber: string };
  customerId?: { name: string };
  accountId?: { code: string; name: string };
  createdBy?: { name: string };
}

export function LedgerAdjustmentPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { projectId } = useProjectContext();
  const lp = useListParams({ sort: '-date' });
  const type = lp.filter('type');
  const query = { ...lp.query, type, projectId: projectId ?? undefined };
  const q = useQuery({ queryKey: ['ledger-adjustments', query], queryFn: () => api.page<Adjustment>('/ledger-adjustments', query) });
  const [creating, setCreating] = React.useState<'credit' | 'debit' | null>(null);
  const [reversing, setReversing] = React.useState<Adjustment | null>(null);
  const [reason, setReason] = React.useState('');
  const reverse = useMutation({
    mutationFn: () => api.post(`/ledger-adjustments/${reversing!.id}/reverse`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ledger-adjustments'] });
      setReversing(null);
      setReason('');
      toast.success('Adjustment reversed');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const columns: Column<Adjustment>[] = [
    { key: 'number', header: 'Note', sortKey: 'number', cell: (r) => <span className="font-medium">{r.number}</span> },
    { key: 'date', header: 'Date', sortKey: 'date', cell: (r) => formatDate(r.date.slice(0, 10)) },
    {
      key: 'type',
      header: 'Type',
      cell: (r) => (r.type === 'credit' ? <Badge variant="success">Credit note</Badge> : <Badge variant="warning">Debit note</Badge>),
    },
    {
      key: 'booking',
      header: 'Booking',
      cell: (r) =>
        r.bookingId ? (
          <span>
            <Link to={`/post-sales/bookings/${r.bookingId.id}`} className="text-primary hover:underline">
              {r.bookingId.bookingNumber}
            </Link>{' '}
            <span className="text-muted-foreground">{r.customerId?.name}</span>
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'reason',
      header: 'Reason',
      cell: (r) => (
        <span>
          {titleCase(r.reason)}
          <span className="block max-w-xs truncate text-xs text-muted-foreground">{r.narration}</span>
        </span>
      ),
    },
    { key: 'account', header: 'Account', hideOnMobile: true, cell: (r) => r.accountId?.name ?? '—' },
    {
      key: 'amount',
      header: 'Amount',
      sortKey: 'amountPaise',
      align: 'right',
      cell: (r) => (
        <span className={`tabular ${r.status === 'reversed' ? 'text-muted-foreground line-through' : ''}`}>
          {r.type === 'credit' ? '−' : '+'}
          {formatINR(r.amountPaise)}
        </span>
      ),
    },
    {
      key: 'status',
      header: '',
      align: 'right',
      cell: (r) =>
        r.status === 'reversed' ? (
          <Badge variant="muted" title={r.reversal?.reason}>
            Reversed
          </Badge>
        ) : (
          can('accounting.adjust') && (
            <Button size="icon-sm" variant="ghost" onClick={() => setReversing(r)} aria-label={`Reverse ${r.number}`}>
              <Undo2 />
            </Button>
          )
        ),
    },
  ];
  return (
    <>
      <PageHeader
        title="Ledger Adjustment"
        description="Credit notes (discounts, waivers) reduce what a buyer owes; debit notes (interest, late fees) add a new due. Both post to the books and the installment schedule."
        actions={
          <Can permission="accounting.adjust">
            <Button variant="outline" onClick={() => setCreating('debit')}>
              <PlusCircle /> Debit note
            </Button>
            <Button onClick={() => setCreating('credit')}>
              <MinusCircle /> Credit note
            </Button>
          </Can>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput value={lp.q} onChange={lp.setQ} placeholder="Search note number" className="w-full sm:w-60" />
        <Select
          className="h-9 w-auto"
          value={type ?? ''}
          onChange={(e) => lp.setFilter('type', e.target.value || undefined)}
          aria-label="Type"
        >
          <option value="">Credit & debit notes</option>
          <option value="credit">Credit notes</option>
          <option value="debit">Debit notes</option>
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
        empty={
          <EmptyState
            title="No adjustments"
            description="Customer ledgers can only be corrected here, so every change is numbered, explained and reversible."
          />
        }
      />
      <AdjustmentDialog type={creating} onClose={() => setCreating(null)} />
      <Dialog open={!!reversing} onOpenChange={(o) => !o && setReversing(null)}>
        <DialogContent
          title={`Reverse ${reversing?.number ?? ''}?`}
          description="The journal entry is reversed and the installment schedule restored."
        >
          <Field label="Reason" htmlFor="adj-rev" required>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReversing(null)}>
              Cancel
            </Button>
            <Button variant="destructive" loading={reverse.isPending} disabled={!reason.trim()} onClick={() => reverse.mutate()}>
              Reverse
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AdjustmentDialog({ type, onClose }: { type: 'credit' | 'debit' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [booking, setBooking] = React.useState<BookingOption | null>(null);
  const [reason, setReason] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [date, setDate] = React.useState(todayInIndia());
  const [dueDate, setDueDate] = React.useState('');
  const [accountId, setAccountId] = React.useState('');
  const [narration, setNarration] = React.useState('');
  const key = React.useRef(newIdempotencyKey());
  React.useEffect(() => {
    if (type) {
      setBooking(null);
      setReason(type === 'credit' ? 'discount' : 'late_fee');
      setAmount('');
      setDate(todayInIndia());
      setDueDate('');
      setAccountId('');
      setNarration('');
      key.current = newIdempotencyKey();
    }
  }, [type]);
  const amountOk = rupeeField('Amount', { min: 1 }).safeParse(amount).success;
  const due = booking ? booking.netAmountPaise - booking.allocatedPaise : 0;
  const save = useMutation({
    mutationFn: () =>
      api.post(
        '/ledger-adjustments',
        {
          bookingId: booking!.id,
          type,
          reason,
          amountPaise: toPaise(amount),
          date,
          dueDate: dueDate || undefined,
          accountId: accountId || undefined,
          narration,
        },
        key.current,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ledger-adjustments'] });
      qc.invalidateQueries({ queryKey: ['booking'] });
      qc.invalidateQueries({ queryKey: ['dues'] });
      toast.success(type === 'credit' ? 'Credit note posted' : 'Debit note posted');
      onClose();
    },
    onError: (e) => {
      key.current = newIdempotencyKey();
      toast.error(errorMessage(e));
    },
  });
  const reasons = ADJUSTMENT_REASONS.filter((r) =>
    (type === 'credit' ? ['discount', 'waiver', 'rounding', 'other'] : ['interest', 'late_fee', 'other']).includes(r),
  );
  return (
    <Dialog open={!!type} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={type === 'credit' ? 'Credit note – reduce dues' : 'Debit note – add a charge'}
        description={
          type === 'credit' ? 'Reduces the latest unpaid installments first.' : 'Adds a new installment to the booking’s schedule.'
        }
        className="max-w-xl"
      >
        <Field
          label="Booking"
          htmlFor="adj-booking"
          required
          hint={booking && type === 'credit' ? `Up to ${formatINR(due)} can be credited` : undefined}
        >
          <BookingPicker id="adj-booking" value={booking} onChange={setBooking} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Reason" htmlFor="adj-reason" required>
            <Select value={reason} onChange={(e) => setReason(e.target.value)}>
              {reasons.map((r) => (
                <option key={r} value={r}>
                  {titleCase(r)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount" htmlFor="adj-amount" required error={amount && !amountOk ? 'Enter an amount' : undefined}>
            <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Date" htmlFor="adj-date" required>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          {type === 'debit' && (
            <Field label="Due date" htmlFor="adj-due" hint="Defaults to the note date">
              <Input type="date" value={dueDate} min={date} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
          )}
          <Field
            label={type === 'credit' ? 'Charge to account' : 'Income account'}
            htmlFor="adj-acc"
            hint="Leave blank for the default by reason"
            className="sm:col-span-2"
          >
            <AccountSelect
              id="adj-acc"
              value={accountId}
              onChange={setAccountId}
              types={type === 'credit' ? ['expense', 'income'] : ['income']}
              placeholder="Default"
            />
          </Field>
          <Field label="Narration" htmlFor="adj-narr" required className="sm:col-span-2">
            <Textarea
              rows={2}
              value={narration}
              onChange={(e) => setNarration(e.target.value)}
              placeholder={type === 'credit' ? 'Festive offer approved by MD' : 'Interest on delayed 2nd installment'}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!booking || !amountOk || !narration.trim()} onClick={() => save.mutate()}>
            Post {type === 'credit' ? 'credit' : 'debit'} note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =====================================================================
// GST vouchers
// =====================================================================

interface GstVoucher {
  id: string;
  number: string;
  direction: 'output' | 'input';
  date: string;
  invoiceNumber: string;
  partyName: string;
  partyGstin?: string;
  description: string;
  taxableValuePaise: number;
  rateBp: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
  interState: boolean;
  status: 'posted' | 'reversed';
  accountId?: { code: string; name: string };
  vendorId?: { name: string };
}
interface GstSummary {
  from: string;
  to: string;
  totals: Record<'output' | 'input', { taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; count: number }>;
  net: { cgstPaise: number; sgstPaise: number; igstPaise: number };
  netPayablePaise: number;
}

export function GstVoucherPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const lp = useListParams({ sort: '-date' });
  const direction = lp.filter('direction');
  const from = lp.filter('from');
  const to = lp.filter('to');
  const query = { ...lp.query, direction, from, to };
  const q = useQuery({ queryKey: ['gst-vouchers', query], queryFn: () => api.page<GstVoucher>('/gst-vouchers', query) });
  const summary = useQuery({
    queryKey: ['gst-vouchers', 'summary', from, to],
    queryFn: () => api.get<GstSummary>('/gst-vouchers/summary', { from, to }),
  });
  const [creating, setCreating] = React.useState<'output' | 'input' | null>(null);
  const [reversing, setReversing] = React.useState<GstVoucher | null>(null);
  const [reason, setReason] = React.useState('');
  const reverse = useMutation({
    mutationFn: () => api.post(`/gst-vouchers/${reversing!.id}/reverse`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gst-vouchers'] });
      setReversing(null);
      setReason('');
      toast.success('Voucher reversed');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const s = summary.data;
  const tax = (t?: { cgstPaise: number; sgstPaise: number; igstPaise: number }) => (t ? t.cgstPaise + t.sgstPaise + t.igstPaise : 0);
  const columns: Column<GstVoucher>[] = [
    { key: 'number', header: 'Voucher', sortKey: 'number', cell: (r) => <span className="font-medium">{r.number}</span> },
    { key: 'date', header: 'Date', sortKey: 'date', cell: (r) => formatDate(r.date.slice(0, 10)) },
    {
      key: 'dir',
      header: 'Type',
      cell: (r) =>
        r.direction === 'output' ? <Badge variant="info">Sale (output)</Badge> : <Badge variant="violet">Purchase (input)</Badge>,
    },
    {
      key: 'party',
      header: 'Party / invoice',
      cell: (r) => (
        <span>
          {r.partyName}
          <span className="block text-xs text-muted-foreground">
            {r.invoiceNumber}
            {r.partyGstin ? ` · ${r.partyGstin}` : ''}
          </span>
        </span>
      ),
    },
    { key: 'taxable', header: 'Taxable', align: 'right', cell: (r) => <span className="tabular">{formatINR(r.taxableValuePaise)}</span> },
    {
      key: 'tax',
      header: 'GST',
      align: 'right',
      cell: (r) => (
        <span className="tabular">
          {formatINR(r.cgstPaise + r.sgstPaise + r.igstPaise)}
          <span className="block text-xs text-muted-foreground">
            {r.rateBp / 100}% {r.interState ? 'IGST' : 'CGST+SGST'}
          </span>
        </span>
      ),
    },
    {
      key: 'total',
      header: 'Total',
      sortKey: 'totalPaise',
      align: 'right',
      cell: (r) => (
        <span className={`tabular ${r.status === 'reversed' ? 'text-muted-foreground line-through' : ''}`}>{formatINR(r.totalPaise)}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (r) =>
        r.status === 'reversed' ? (
          <Badge variant="muted">Reversed</Badge>
        ) : (
          can('accounting.reverse') && (
            <Button size="icon-sm" variant="ghost" onClick={() => setReversing(r)} aria-label={`Reverse ${r.number}`}>
              <Undo2 />
            </Button>
          )
        ),
    },
  ];
  return (
    <>
      <PageHeader
        title="GST Voucher"
        description="Taxable sales and purchases with CGST/SGST or IGST posted to the GST ledgers"
        actions={
          <Can permission="accounting.create">
            <Button variant="outline" onClick={() => setCreating('input')}>
              <Plus /> Purchase (input)
            </Button>
            <Button onClick={() => setCreating('output')}>
              <Plus /> Sale (output)
            </Button>
          </Can>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Output GST"
          value={formatINR(tax(s?.totals.output))}
          hint={`${s?.totals.output.count ?? 0} sales vouchers`}
          loading={summary.isPending}
        />
        <StatCard
          label="Input tax credit"
          value={formatINR(tax(s?.totals.input))}
          hint={`${s?.totals.input.count ?? 0} purchase vouchers`}
          loading={summary.isPending}
        />
        <StatCard
          label={(s?.netPayablePaise ?? 0) >= 0 ? 'Net GST payable' : 'Net credit carried forward'}
          value={formatINR(Math.abs(s?.netPayablePaise ?? 0))}
          hint={s ? `${formatDate(s.from)} – ${formatDate(s.to)}` : undefined}
          tone={(s?.netPayablePaise ?? 0) > 0 ? 'warning' : 'success'}
          loading={summary.isPending}
        />
      </div>
      {s && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Tax by component</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-1 font-medium" />
                  <th className="py-1 text-right font-medium">CGST</th>
                  <th className="py-1 text-right font-medium">SGST</th>
                  <th className="py-1 text-right font-medium">IGST</th>
                </tr>
              </thead>
              <tbody className="tabular">
                <tr>
                  <td className="py-1">Output</td>
                  <td className="py-1 text-right">{formatINR(s.totals.output.cgstPaise)}</td>
                  <td className="py-1 text-right">{formatINR(s.totals.output.sgstPaise)}</td>
                  <td className="py-1 text-right">{formatINR(s.totals.output.igstPaise)}</td>
                </tr>
                <tr>
                  <td className="py-1">Input credit</td>
                  <td className="py-1 text-right">−{formatINR(s.totals.input.cgstPaise)}</td>
                  <td className="py-1 text-right">−{formatINR(s.totals.input.sgstPaise)}</td>
                  <td className="py-1 text-right">−{formatINR(s.totals.input.igstPaise)}</td>
                </tr>
                <tr className="border-t font-semibold">
                  <td className="pt-2">Net</td>
                  <td className="pt-2 text-right">{formatINR(s.net.cgstPaise)}</td>
                  <td className="pt-2 text-right">{formatINR(s.net.sgstPaise)}</td>
                  <td className="pt-2 text-right">{formatINR(s.net.igstPaise)}</td>
                </tr>
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted-foreground">
              For filing, reconcile with GSTR-1 / GSTR-3B; cross-utilisation rules for IGST credit apply.
            </p>
          </CardContent>
        </Card>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput value={lp.q} onChange={lp.setQ} placeholder="Voucher, invoice, party, GSTIN" className="w-full sm:w-64" />
        <Select
          className="h-9 w-auto"
          value={direction ?? ''}
          onChange={(e) => lp.setFilter('direction', e.target.value || undefined)}
          aria-label="Type"
        >
          <option value="">Sales & purchases</option>
          <option value="output">Sales (output)</option>
          <option value="input">Purchases (input)</option>
        </Select>
        <DateRange lp={lp} />
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
            title="No GST vouchers"
            description="Record taxable sales (maintenance, commercial rent…) and purchases with input credit."
          />
        }
      />
      <GstDialog direction={creating} onClose={() => setCreating(null)} />
      <Dialog open={!!reversing} onOpenChange={(o) => !o && setReversing(null)}>
        <DialogContent title={`Reverse ${reversing?.number ?? ''}?`}>
          <Field label="Reason" htmlFor="gst-rev" required>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReversing(null)}>
              Cancel
            </Button>
            <Button variant="destructive" loading={reverse.isPending} disabled={!reason.trim()} onClick={() => reverse.mutate()}>
              Reverse
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Same rounding as the server: CGST and SGST each at half the rate. */
function previewTax(taxable: number, rateBp: number, interState: boolean) {
  const pct = (bp: number) => Math.round((taxable * bp) / 10_000);
  if (interState) {
    const igst = pct(rateBp);
    return { cgst: 0, sgst: 0, igst, total: taxable + igst };
  }
  const half = pct(rateBp / 2);
  return { cgst: half, sgst: half, igst: 0, total: taxable + 2 * half };
}

function GstDialog({ direction, onClose }: { direction: 'output' | 'input' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const vendors = useVendors(direction === 'input');
  const [v, setV] = React.useState<Record<string, string | boolean>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const key = React.useRef(newIdempotencyKey());
  React.useEffect(() => {
    if (direction) {
      setV({
        date: todayInIndia(),
        invoiceNumber: '',
        partyName: '',
        partyGstin: '',
        description: '',
        hsnSac: '',
        taxable: '',
        rateBp: '1800',
        interState: false,
        accountId: '',
        settle: 'paid',
        settlementAccountId: '',
        mode: 'neft',
        vendorId: '',
        projectId: '',
      });
      setErrors({});
      key.current = newIdempotencyKey();
    }
  }, [direction]);
  const set = (k: string, val: string | boolean) => setV((s) => ({ ...s, [k]: val }));
  const taxableOk = rupeeField('Taxable value', { min: 1 }).safeParse(String(v.taxable ?? '')).success;
  const t = taxableOk ? previewTax(toPaise(String(v.taxable)), Number(v.rateBp), v.interState === true) : null;
  const viaVendor = direction === 'input' && v.settle === 'payable';
  const save = useMutation({
    mutationFn: () =>
      api.post(
        '/gst-vouchers',
        {
          direction,
          date: v.date,
          invoiceNumber: String(v.invoiceNumber).trim(),
          partyName: String(viaVendor ? (vendors.data?.find((x) => x.id === v.vendorId)?.name ?? v.partyName) : v.partyName).trim(),
          partyGstin: v.partyGstin ? String(v.partyGstin).toUpperCase() : undefined,
          interState: v.interState === true,
          hsnSac: v.hsnSac || undefined,
          description: String(v.description).trim(),
          taxableValuePaise: toPaise(String(v.taxable)),
          rateBp: Number(v.rateBp),
          accountId: v.accountId,
          ...(viaVendor ? { vendorId: v.vendorId } : { settlementAccountId: v.settlementAccountId || undefined, mode: v.mode }),
          projectId: v.projectId || undefined,
        },
        key.current,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gst-vouchers'] });
      toast.success('GST voucher posted');
      onClose();
    },
    onError: (e) => {
      key.current = newIdempotencyKey();
      setErrors(fieldErrors(e));
      toast.error(errorMessage(e));
    },
  });
  const ready = taxableOk && v.invoiceNumber && v.description && v.accountId && (viaVendor ? v.vendorId : v.partyName);
  return (
    <Dialog open={!!direction} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={direction === 'output' ? 'GST sale (output tax)' : 'GST purchase (input tax credit)'} className="max-w-2xl">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Invoice date" htmlFor="g-date" required>
            <Input type="date" value={String(v.date ?? '')} onChange={(e) => set('date', e.target.value)} />
          </Field>
          <Field label="Invoice number" htmlFor="g-inv" required error={errors.invoiceNumber}>
            <Input value={String(v.invoiceNumber ?? '')} onChange={(e) => set('invoiceNumber', e.target.value)} />
          </Field>
          {direction === 'input' && (
            <fieldset className="sm:col-span-2 flex flex-wrap gap-4 text-sm">
              <legend className="sr-only">Settlement</legend>
              <label className="flex items-center gap-2">
                <input type="radio" checked={v.settle === 'paid'} onChange={() => set('settle', 'paid')} /> Paid now
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={v.settle === 'payable'} onChange={() => set('settle', 'payable')} /> Vendor bill (pay later)
              </label>
            </fieldset>
          )}
          {viaVendor ? (
            <Field label="Vendor" htmlFor="g-vendor" required className="sm:col-span-2">
              <Select value={String(v.vendorId ?? '')} onChange={(e) => set('vendorId', e.target.value)}>
                <option value="">Choose…</option>
                {vendors.data?.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label={direction === 'output' ? 'Customer / party' : 'Supplier'} htmlFor="g-party" required>
              <Input value={String(v.partyName ?? '')} onChange={(e) => set('partyName', e.target.value)} />
            </Field>
          )}
          <Field label="Party GSTIN" htmlFor="g-gstin" error={errors.partyGstin}>
            <Input className="uppercase" value={String(v.partyGstin ?? '')} onChange={(e) => set('partyGstin', e.target.value)} />
          </Field>
          <Field label="Description" htmlFor="g-desc" required className="sm:col-span-2">
            <Input
              value={String(v.description ?? '')}
              onChange={(e) => set('description', e.target.value)}
              placeholder={direction === 'output' ? 'Maintenance charges – Oct 2026' : 'Cement – 400 bags'}
            />
          </Field>
          <Field label="HSN / SAC" htmlFor="g-hsn">
            <Input value={String(v.hsnSac ?? '')} onChange={(e) => set('hsnSac', e.target.value)} />
          </Field>
          <Field label="Taxable value" htmlFor="g-taxable" required>
            <MoneyInput value={String(v.taxable ?? '')} onChange={(e) => set('taxable', e.target.value)} />
          </Field>
          <Field label="GST rate" htmlFor="g-rate" required>
            <Select value={String(v.rateBp ?? '1800')} onChange={(e) => set('rateBp', e.target.value)}>
              {GST_RATES_BP.map((r) => (
                <option key={r} value={r}>
                  {r / 100}%
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-center gap-2 self-end pb-2">
            <Checkbox id="g-inter" checked={v.interState === true} onCheckedChange={(c) => set('interState', c === true)} />
            <Label htmlFor="g-inter">Inter-state (IGST)</Label>
          </div>
          <Field label={direction === 'output' ? 'Income account' : 'Expense / asset account'} htmlFor="g-acc" required>
            <AccountSelect
              id="g-acc"
              value={String(v.accountId ?? '')}
              onChange={(x) => set('accountId', x)}
              types={direction === 'output' ? ['income'] : ['expense', 'asset']}
            />
          </Field>
          {!viaVendor && (
            <>
              <Field label={direction === 'output' ? 'Received into' : 'Paid from'} htmlFor="g-settle">
                <AccountSelect
                  id="g-settle"
                  value={String(v.settlementAccountId ?? '')}
                  onChange={(x) => set('settlementAccountId', x)}
                  cashBankOnly
                  placeholder="Default by mode"
                />
              </Field>
              <Field label="Mode" htmlFor="g-mode">
                <Select value={String(v.mode ?? 'neft')} onChange={(e) => set('mode', e.target.value)}>
                  {PAYMENT_MODES.map((m) => (
                    <option key={m} value={m}>
                      {m.toUpperCase()}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          )}
          <Field label="Project" htmlFor="g-project">
            <ProjectSelect value={String(v.projectId ?? '')} onChange={(x) => set('projectId', x)} allowAll allLabel="—" />
          </Field>
        </div>
        {t && (
          <div className="rounded-md bg-muted/50 p-3 text-sm tabular">
            {v.interState ? (
              <span>IGST {formatINR(t.igst)}</span>
            ) : (
              <span>
                CGST {formatINR(t.cgst)} · SGST {formatINR(t.sgst)}
              </span>
            )}
            <span className="float-right font-semibold">Invoice total {formatINR(t.total)}</span>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!ready} onClick={() => save.mutate()}>
            Post voucher
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
