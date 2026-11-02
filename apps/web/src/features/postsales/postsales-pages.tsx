import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Ban, CheckCircle2, FileDown, IndianRupee, Undo2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api, download, errorMessage } from '@/lib/api';
import { formatDate, formatINR } from '@/lib/format';
import { useListParams } from '@/hooks/use-list-params';
import { useProjectContext } from '@/hooks/use-project';
import { Can, useAuth } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Badge, Select, Textarea } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/overlays';
import { DataTable, type Column } from '@/components/data-table';
import { Field, PageHeader, StatCard } from '@/components/common';
import { EmptyState } from '@/components/states';
import { SearchInput } from '@/components/search-input';
import { BookingPicker, type BookingOption } from '@/components/pickers';
import { MoneyInput, rupeeField, toPaise } from '@/components/money';

interface Party {
  id: string;
  name: string;
  phone?: string;
}

// =====================================================================
// Booking cancellations
// =====================================================================

interface Cancellation {
  id: string;
  bookingNumber: string;
  bookingDate: string;
  status: string;
  closedAt?: string;
  cancellation?: { reason: string; chargePaise: number; by?: { name: string } };
  netAmountPaise: number;
  receivedPaise: number;
  refundablePaise: number;
  refundedPaise: number;
  units: string[];
  customerId?: Party;
  projectId?: { id: string; name: string };
}

export function CancellationsPage() {
  const navigate = useNavigate();
  const { projectId } = useProjectContext();
  const lp = useListParams({ sort: '-closedAt' });
  const refund = lp.filter('refund');
  const query = { ...lp.query, refund, projectId: projectId ?? undefined };
  const q = useQuery({ queryKey: ['cancellations', query], queryFn: () => api.page<Cancellation>('/post-sales/cancellations', query) });
  const summary = useQuery({
    queryKey: ['cancellations', 'summary', projectId],
    queryFn: () => api.get<{ count: number; chargesPaise: number; refundablePaise: number; refundedPaise: number; pendingRefundPaise: number }>('/post-sales/cancellations/summary', { projectId: projectId ?? undefined }),
  });
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const columns: Column<Cancellation>[] = [
    { key: 'number', header: 'Booking', sortKey: 'bookingNumber', cell: (r) => <span className="font-medium">{r.bookingNumber}</span> },
    { key: 'customer', header: 'Customer', cell: (r) => r.customerId?.name ?? '—' },
    { key: 'units', header: 'Units', cell: (r) => `${r.projectId?.name ?? ''} · ${r.units.join(', ')}` },
    { key: 'date', header: 'Cancelled', sortKey: 'closedAt', cell: (r) => (r.closedAt ? formatDate(r.closedAt) : '—') },
    { key: 'reason', header: 'Reason', hideOnMobile: true, cell: (r) => <span className="line-clamp-1 max-w-xs">{r.status === 'expired' ? 'Reservation expired' : r.cancellation?.reason}</span> },
    { key: 'received', header: 'Received', align: 'right', cell: (r) => <span className="tabular">{formatINR(r.receivedPaise)}</span> },
    { key: 'charge', header: 'Retained', align: 'right', cell: (r) => <span className="tabular">{formatINR(r.cancellation?.chargePaise ?? 0)}</span> },
    {
      key: 'refund',
      header: 'Refund',
      align: 'right',
      sortKey: 'refundablePaise',
      cell: (r) => {
        const pending = r.refundablePaise - r.refundedPaise;
        return pending > 0 ? <Badge variant="warning">{formatINR(pending)} due</Badge> : r.refundablePaise > 0 ? <Badge variant="success">Settled</Badge> : <span className="text-muted-foreground">—</span>;
      },
    },
  ];
  const s = summary.data;
  return (
    <>
      <PageHeader
        title="Booking Cancellations"
        description="Cancelled and expired bookings, charges retained and refunds still owed"
        actions={
          <Can permission="bookings.cancel">
            <Button variant="outline" onClick={() => setCancelOpen(true)}>
              <Ban /> Cancel a booking
            </Button>
          </Can>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <StatCard label="Cancellations" value={s?.count ?? '—'} icon={XCircle} loading={summary.isPending} />
        <StatCard label="Charges retained" value={formatINR(s?.chargesPaise ?? 0)} loading={summary.isPending} />
        <StatCard label="Refunded" value={formatINR(s?.refundedPaise ?? 0)} tone="success" loading={summary.isPending} />
        <StatCard label="Refunds pending" value={formatINR(s?.pendingRefundPaise ?? 0)} icon={IndianRupee} tone={s?.pendingRefundPaise ? 'warning' : 'default'} loading={summary.isPending} />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput value={lp.q} onChange={lp.setQ} placeholder="Search booking no." className="w-full sm:w-64" />
        <Select className="h-9 w-auto" value={refund ?? ''} onChange={(e) => lp.setFilter('refund', e.target.value || undefined)} aria-label="Refund">
          <option value="">All</option>
          <option value="pending">Refund pending</option>
          <option value="settled">Refund settled</option>
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
        onRowClick={(r) => navigate(`/post-sales/bookings/${r.id}`)}
        empty={<EmptyState title="No cancellations" description="Cancelled and expired bookings appear here with their refund status." />}
      />
      <CancelBookingDialog open={cancelOpen} onOpenChange={setCancelOpen} />
    </>
  );
}

function CancelBookingDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [booking, setBooking] = React.useState<BookingOption | null>(null);
  const [reason, setReason] = React.useState('');
  const [charge, setCharge] = React.useState('');
  React.useEffect(() => {
    if (open) {
      setBooking(null);
      setReason('');
      setCharge('');
    }
  }, [open]);
  const chargeOk = rupeeField('Charge', { required: false }).safeParse(charge).success;
  const save = useMutation({
    mutationFn: () => api.post(`/bookings/${booking!.id}/cancel`, { reason, cancellationChargePaise: toPaise(charge) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cancellations'] });
      qc.invalidateQueries({ queryKey: ['bookings'] });
      toast.success(`${booking?.bookingNumber} cancelled. Units are available again.`);
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Cancel a booking" description="Releases the units and parking, reverses the sale and moves money received to refunds payable.">
        <Field label="Booking" htmlFor="cx-booking" required>
          <BookingPicker id="cx-booking" value={booking} onChange={setBooking} />
        </Field>
        <Field label="Reason" htmlFor="cx-reason" required>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Field label="Cancellation charges retained" htmlFor="cx-charge" error={chargeOk ? undefined : 'Enter an amount'} hint="Cannot exceed the amount received">
          <MoneyInput value={charge} onChange={(e) => setCharge(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep booking
          </Button>
          <Button variant="destructive" loading={save.isPending} disabled={!booking || !reason.trim() || !chargeOk} onClick={() => save.mutate()}>
            Cancel booking
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =====================================================================
// Allotment letters
// =====================================================================

interface Allotment {
  id: string;
  bookingNumber: string;
  bookingDate: string;
  netAmountPaise: number;
  receivedPaise: number;
  units: string[];
  allotment?: { issuedAt: string; issuedBy?: { name: string }; deliveredVia?: string };
  customerId?: Party;
  projectId?: { id: string; name: string };
}
const VIA = ['by hand', 'email', 'whatsapp', 'courier', 'post'];

export function AllotmentsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { projectId } = useProjectContext();
  const lp = useListParams({ sort: '-bookingDate' });
  const issued = lp.filter('issued');
  const query = { ...lp.query, issued, projectId: projectId ?? undefined };
  const q = useQuery({ queryKey: ['allotments', query], queryFn: () => api.page<Allotment>('/post-sales/allotments', query) });
  const summary = useQuery({ queryKey: ['allotments', 'summary', projectId], queryFn: () => api.get<{ issued: number; pending: number }>('/post-sales/allotments/summary', { projectId: projectId ?? undefined }) });
  const [issuing, setIssuing] = React.useState<Allotment | null>(null);
  const [via, setVia] = React.useState('by hand');
  const mark = useMutation({
    mutationFn: ({ row, on }: { row: Allotment; on: boolean }) => api.post(`/post-sales/bookings/${row.id}/allotment`, { issued: on, via: on ? via : undefined }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['allotments'] });
      setIssuing(null);
      toast.success(v.on ? 'Marked as issued' : 'Marked as not issued');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const columns: Column<Allotment>[] = [
    {
      key: 'number',
      header: 'Booking',
      sortKey: 'bookingNumber',
      cell: (r) => (
        <Link to={`/post-sales/bookings/${r.id}`} className="font-medium text-primary hover:underline">
          {r.bookingNumber}
        </Link>
      ),
    },
    { key: 'date', header: 'Booked on', sortKey: 'bookingDate', cell: (r) => formatDate(r.bookingDate) },
    { key: 'customer', header: 'Allottee', cell: (r) => r.customerId?.name ?? '—' },
    { key: 'units', header: 'Units', cell: (r) => `${r.projectId?.name ?? ''} · ${r.units.join(', ')}` },
    { key: 'value', header: 'Consideration', sortKey: 'netAmountPaise', align: 'right', cell: (r) => <span className="tabular">{formatINR(r.netAmountPaise)}</span> },
    {
      key: 'issued',
      header: 'Letter',
      cell: (r) =>
        r.allotment?.issuedAt ? (
          <span className="text-sm">
            <Badge variant="success">Issued</Badge> <span className="text-muted-foreground">{formatDate(r.allotment.issuedAt)}{r.allotment.deliveredVia ? ` · ${r.allotment.deliveredVia}` : ''}</span>
          </span>
        ) : (
          <Badge variant="warning">Pending</Badge>
        ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="outline" onClick={() => void download(`/bookings/${r.id}/allotment.pdf`, undefined, 'open')}>
            <FileDown /> Letter
          </Button>
          {can('postSales.update') &&
            (r.allotment?.issuedAt ? (
              <Button size="icon-sm" variant="ghost" onClick={() => mark.mutate({ row: r, on: false })} aria-label="Mark not issued">
                <Undo2 />
              </Button>
            ) : (
              <Button size="sm" onClick={() => setIssuing(r)}>
                <CheckCircle2 /> Mark issued
              </Button>
            ))}
        </div>
      ),
    },
  ];
  return (
    <>
      <PageHeader title="Allotment Letters" description="Generate allotment letters for confirmed bookings and track which have been handed over" />
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <StatCard label="Letters pending" value={summary.data?.pending ?? '—'} tone={summary.data?.pending ? 'warning' : 'default'} loading={summary.isPending} />
        <StatCard label="Letters issued" value={summary.data?.issued ?? '—'} tone="success" loading={summary.isPending} />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput value={lp.q} onChange={lp.setQ} placeholder="Search booking no." className="w-full sm:w-64" />
        <Select className="h-9 w-auto" value={issued ?? ''} onChange={(e) => lp.setFilter('issued', e.target.value || undefined)} aria-label="Letter status">
          <option value="">All</option>
          <option value="false">Pending</option>
          <option value="true">Issued</option>
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
        empty={<EmptyState title="No confirmed bookings" description="Allotment letters are issued once a booking is confirmed." />}
      />
      <Dialog open={!!issuing} onOpenChange={(o) => !o && setIssuing(null)}>
        <DialogContent title={`Mark ${issuing?.bookingNumber} letter as issued`}>
          <Field label="Delivered" htmlFor="al-via">
            <Select value={via} onChange={(e) => setVia(e.target.value)}>
              {VIA.map((v) => (
                <option key={v} value={v}>
                  {v[0]!.toUpperCase() + v.slice(1)}
                </option>
              ))}
            </Select>
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIssuing(null)}>
              Cancel
            </Button>
            <Button loading={mark.isPending} onClick={() => issuing && mark.mutate({ row: issuing, on: true })}>
              Mark issued
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

