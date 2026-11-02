import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Download, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { api, download, errorMessage } from '@/lib/api';
import { formatDate, formatDateTime, formatINR } from '@/lib/format';
import { useListParams } from '@/hooks/use-list-params';
import { useProjectContext } from '@/hooks/use-project';
import { Can } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, Input, Select } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/data-table';
import { DescriptionList, PageHeader, StatusBadge } from '@/components/common';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/states';
import { SearchInput } from '@/components/search-input';

interface PaymentRow {
  id: string;
  number: string;
  kind: 'receipt' | 'refund';
  amountPaise: number;
  mode: string;
  reference?: string;
  date: string;
  status: string;
  customerId?: { id: string; name: string };
  bookingId?: { id: string; bookingNumber: string };
}

export function PaymentsPage() {
  const lp = useListParams({ sort: '-createdAt' });
  const navigate = useNavigate();
  const { projectId } = useProjectContext();
  const filters = { kind: lp.filter('kind'), from: lp.filter('from'), to: lp.filter('to') };
  const q = useQuery({
    queryKey: ['payments', projectId, lp.query, filters],
    queryFn: () => api.page<PaymentRow>('/payments', { ...lp.query, ...filters, projectId: projectId ?? undefined }),
    placeholderData: (p) => p,
  });
  const columns: Column<PaymentRow>[] = [
    { key: 'no', header: 'Number', sortKey: 'number', cell: (p) => <span className="font-medium">{p.number}</span> },
    { key: 'date', header: 'Date', sortKey: 'date', cell: (p) => formatDate(p.date.slice(0, 10)) },
    { key: 'customer', header: 'Customer', cell: (p) => p.customerId?.name ?? '—' },
    { key: 'booking', header: 'Booking', cell: (p) => p.bookingId?.bookingNumber ?? '—', hideOnMobile: true },
    { key: 'mode', header: 'Mode', cell: (p) => `${p.mode.toUpperCase()}${p.reference ? ` · ${p.reference}` : ''}`, hideOnMobile: true },
    {
      key: 'amount',
      header: 'Amount',
      sortKey: 'amountPaise',
      align: 'right',
      cell: (p) => (
        <span className={p.kind === 'refund' ? 'text-destructive' : ''}>
          {p.kind === 'refund' ? '−' : ''}
          {formatINR(p.amountPaise)}
        </span>
      ),
    },
    { key: 'status', header: 'Status', cell: (p) => <StatusBadge status={p.status} /> },
  ];
  return (
    <>
      <PageHeader
        title="Receipts & refunds"
        description="Every rupee received or paid back, with its receipt number"
        actions={
          <Can permission="reports.export">
            <Button
              variant="outline"
              onClick={() =>
                void download('/payments/export.xlsx', { ...filters, q: lp.q, projectId: projectId ?? undefined }).catch((e) =>
                  toast.error(errorMessage(e)),
                )
              }
            >
              <Download /> Excel
            </Button>
          </Can>
        }
      />
      <div className="mb-4 flex flex-col gap-2 lg:flex-row">
        <SearchInput value={lp.q} onChange={lp.setQ} placeholder="Receipt no., reference or customer" />
        <Select
          className="lg:w-36"
          value={filters.kind ?? ''}
          onChange={(e) => lp.setFilter('kind', e.target.value || undefined)}
          aria-label="Type"
        >
          <option value="">All types</option>
          <option value="receipt">Receipts</option>
          <option value="refund">Refunds</option>
        </Select>
        <Input
          type="date"
          className="lg:w-40"
          value={filters.from ?? ''}
          onChange={(e) => lp.setFilter('from', e.target.value || undefined)}
          aria-label="From date"
        />
        <Input
          type="date"
          className="lg:w-40"
          value={filters.to ?? ''}
          onChange={(e) => lp.setFilter('to', e.target.value || undefined)}
          aria-label="To date"
        />
      </div>
      <DataTable
        columns={columns}
        rows={q.data?.items}
        rowKey={(p) => p.id}
        loading={q.isPending}
        error={q.error}
        onRetry={() => q.refetch()}
        meta={q.data?.meta}
        onPageChange={lp.setPage}
        pageSize={lp.pageSize}
        onPageSizeChange={lp.setPageSize}
        sort={lp.sort}
        onSortChange={lp.setSort}
        onRowClick={(p) => navigate(`/account/customer-receipts/${p.id}`)}
        empty={<EmptyState title="No payments found" />}
      />
    </>
  );
}

interface PaymentDetail extends PaymentRow {
  allocatedPaise: number;
  advancePaise: number;
  bankName?: string;
  remarks?: string;
  createdAt: string;
  accountId?: { name: string; code: string };
  projectId?: { name: string };
  journalEntryId?: string;
  reversal?: { reason: string; at: string };
  allocations: {
    id: string;
    amountPaise: number;
    reversedAt?: string;
    installmentId?: { name: string; sequence: number; dueDate: string };
  }[];
}

export function PaymentDetailPage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['payment', id], queryFn: () => api.get<PaymentDetail>(`/payments/${id}`) });
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const p = q.data;
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Receipts & refunds', to: '/account/customer-receipts' }, { label: p.number }]}
        title={
          <span className="flex items-center gap-3">
            {p.number} <StatusBadge status={p.status} />
          </span>
        }
        description={`${p.kind === 'refund' ? 'Refund' : 'Receipt'} of ${formatINR(p.amountPaise)}`}
        actions={
          <Button
            variant="outline"
            onClick={() => void download(`/payments/${p.id}/receipt.pdf`, undefined, 'open').catch((e) => toast.error(errorMessage(e)))}
          >
            <FileText /> Print PDF
          </Button>
        }
      />
      {p.reversal?.reason && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
          Reversed on {formatDateTime(p.reversal.at)}: {p.reversal.reason}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="pt-5">
            <DescriptionList
              items={[
                { label: 'Date', value: formatDate(p.date.slice(0, 10)) },
                {
                  label: 'Customer',
                  value: p.customerId ? (
                    <Link className="text-primary hover:underline" to={`/post-sales/customers/${p.customerId.id}`}>
                      {p.customerId.name}
                    </Link>
                  ) : (
                    '—'
                  ),
                },
                {
                  label: 'Booking',
                  value: p.bookingId ? (
                    <Link className="text-primary hover:underline" to={`/post-sales/bookings/${p.bookingId.id}`}>
                      {p.bookingId.bookingNumber}
                    </Link>
                  ) : (
                    '—'
                  ),
                },
                { label: 'Project', value: p.projectId?.name },
                { label: 'Mode', value: `${p.mode.toUpperCase()}${p.reference ? ` · ${p.reference}` : ''}` },
                { label: 'Bank', value: p.bankName },
                {
                  label: p.kind === 'refund' ? 'Paid from' : 'Deposited to',
                  value: p.accountId ? `${p.accountId.code} · ${p.accountId.name}` : '—',
                },
                { label: 'Recorded', value: formatDateTime(p.createdAt) },
              ]}
            />
            {p.remarks && <p className="mt-4 text-sm text-muted-foreground">{p.remarks}</p>}
          </CardContent>
        </Card>
        {p.kind === 'receipt' && (
          <Card>
            <CardHeader>
              <CardTitle>Allocation</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y text-sm">
                {p.allocations.map((a) => (
                  <li key={a.id} className="flex justify-between py-2">
                    <span>
                      {a.installmentId?.sequence}. {a.installmentId?.name}
                      {a.reversedAt && <span className="ml-2 text-xs text-destructive">reversed</span>}
                    </span>
                    <span className="tabular">{formatINR(a.amountPaise)}</span>
                  </li>
                ))}
                {p.advancePaise > 0 && (
                  <li className="flex justify-between py-2">
                    <span>Held as customer advance</span>
                    <span className="tabular">{formatINR(p.advancePaise)}</span>
                  </li>
                )}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
