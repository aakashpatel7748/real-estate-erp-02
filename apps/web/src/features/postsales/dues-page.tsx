import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlarmClock, FilePlus2, IndianRupee, MessageSquarePlus, PhoneCall, ReceiptIndianRupee } from 'lucide-react';
import { toast } from 'sonner';
import { FOLLOWUP_TYPES, todayInIndia } from '@erp/shared';
import { api, errorMessage } from '@/lib/api';
import { formatDate, formatDateTime, formatINR, titleCase } from '@/lib/format';
import { useListParams } from '@/hooks/use-list-params';
import { useProjectContext } from '@/hooks/use-project';
import { useAuth } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Badge, Input, Select, Textarea } from '@/components/ui/primitives';
import { Sheet, SheetContent } from '@/components/ui/overlays';
import { DataTable, type Column } from '@/components/data-table';
import { Field, PageHeader, StatCard } from '@/components/common';
import { EmptyState } from '@/components/states';
import { SearchInput } from '@/components/search-input';
import { MoneyInput, rupeeField, toPaise } from '@/components/money';
import { WhatsAppButton } from '@/components/whatsapp-button';
import { RecordPaymentDialog } from '@/features/payments/payment-dialogs';
import { cn } from '@/lib/utils';

interface Due {
  id: string;
  bookingId: string;
  outstandingPaise: number;
  overduePaise: number;
  upcomingPaise: number;
  daysOverdue: number;
  oldestOverdue?: string;
  nextDue?: string;
  customer?: { _id: string; name: string; phone: string; customerCode: string };
  booking?: { bookingNumber: string; netAmountPaise: number; receivedPaise: number };
  lastFollowUp?: {
    type: string;
    note: string;
    createdAt: string;
    nextFollowUpOn?: string;
    promisedAmountPaise?: number;
    promisedOn?: string;
  } | null;
}
interface Summary {
  overduePaise: number;
  outstandingPaise: number;
  upcomingPaise: number;
  aging: Record<string, { amountPaise: number; bookings: number }>;
}
interface FollowUp {
  id: string;
  type: string;
  note: string;
  promisedAmountPaise?: number;
  promisedOn?: string;
  nextFollowUpOn?: string;
  createdAt: string;
  createdBy?: { name: string };
}

const BUCKETS = [
  { key: 'all', label: 'All dues' },
  { key: 'upcoming', label: 'Due in 30 days' },
  { key: '0_30', label: '1–30 days' },
  { key: '31_60', label: '31–60 days' },
  { key: '61_90', label: '61–90 days' },
  { key: '90_plus', label: '90+ days' },
];

export function DuesPage() {
  const { projectId } = useProjectContext();
  const lp = useListParams({ sort: '-overduePaise' });
  const bucket = lp.filter('bucket') ?? 'all';
  const followUp = lp.filter('followUp');
  const query = { ...lp.query, bucket, followUp, projectId: projectId ?? undefined };
  const q = useQuery({ queryKey: ['dues', query], queryFn: () => api.page<Due>('/post-sales/dues', query) });
  const summary = useQuery({
    queryKey: ['dues', 'summary', projectId],
    queryFn: () => api.get<Summary>('/post-sales/dues/summary', { projectId: projectId ?? undefined }),
  });
  const [open, setOpen] = React.useState<Due | null>(null);
  const today = todayInIndia();
  const columns: Column<Due>[] = [
    {
      key: 'customer',
      header: 'Customer',
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{r.customer?.name}</p>
          <p className="text-xs text-muted-foreground">
            {r.booking?.bookingNumber} · {r.customer?.phone}
          </p>
        </div>
      ),
    },
    {
      key: 'overdue',
      header: 'Overdue',
      sortKey: 'overduePaise',
      align: 'right',
      cell: (r) => (
        <span className={cn('tabular', r.overduePaise > 0 && 'font-semibold text-destructive')}>{formatINR(r.overduePaise)}</span>
      ),
    },
    {
      key: 'days',
      header: 'Days late',
      sortKey: 'daysOverdue',
      align: 'right',
      cell: (r) =>
        r.daysOverdue ? (
          <Badge variant={r.daysOverdue > 90 ? 'destructive' : r.daysOverdue > 30 ? 'warning' : 'muted'}>{r.daysOverdue} d</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'upcoming',
      header: 'Next 30 days',
      sortKey: 'upcomingPaise',
      align: 'right',
      hideOnMobile: true,
      cell: (r) => <span className="tabular">{formatINR(r.upcomingPaise)}</span>,
    },
    {
      key: 'outstanding',
      header: 'Total outstanding',
      sortKey: 'outstandingPaise',
      align: 'right',
      cell: (r) => <span className="tabular">{formatINR(r.outstandingPaise)}</span>,
    },
    {
      key: 'follow',
      header: 'Last follow-up',
      hideOnMobile: true,
      cell: (r) =>
        r.lastFollowUp ? (
          <div className="max-w-56 text-xs">
            <p className="truncate">
              {titleCase(r.lastFollowUp.type)}: {r.lastFollowUp.note}
            </p>
            {r.lastFollowUp.nextFollowUpOn && (
              <p
                className={cn(
                  r.lastFollowUp.nextFollowUpOn.slice(0, 10) <= today ? 'font-medium text-destructive' : 'text-muted-foreground',
                )}
              >
                Next {formatDate(r.lastFollowUp.nextFollowUpOn.slice(0, 10))}
              </p>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Never contacted</span>
        ),
    },
  ];
  const s = summary.data;
  return (
    <>
      <PageHeader
        title="Dues & Collection Follow-Ups"
        description="Who owes what, how late, and what they promised. Log every call and send reminders on WhatsApp."
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Overdue"
          value={formatINR(s?.overduePaise ?? 0)}
          icon={AlarmClock}
          tone={s?.overduePaise ? 'danger' : 'default'}
          loading={summary.isPending}
        />
        <StatCard label="Falling due in 30 days" value={formatINR(s?.upcomingPaise ?? 0)} icon={IndianRupee} loading={summary.isPending} />
        <StatCard
          label="Total receivable"
          value={formatINR(s?.outstandingPaise ?? 0)}
          icon={ReceiptIndianRupee}
          loading={summary.isPending}
        />
      </div>
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Aging">
        {BUCKETS.map((b) => {
          const a = s?.aging[b.key];
          return (
            <button
              key={b.key}
              type="button"
              role="tab"
              aria-selected={bucket === b.key}
              onClick={() => lp.setFilter('bucket', b.key === 'all' ? undefined : b.key)}
              className={cn(
                'cursor-pointer rounded-full border px-3 py-1.5 text-sm transition-colors',
                bucket === b.key ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted',
              )}
            >
              {b.label}
              {a && (
                <span className="ml-1.5 opacity-75">
                  · {a.bookings} · {formatINR(a.amountPaise, { decimals: false })}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput value={lp.q} onChange={lp.setQ} placeholder="Search customer, phone, booking" className="w-full sm:w-72" />
        <Select
          className="h-9 w-auto"
          value={followUp ?? ''}
          onChange={(e) => lp.setFilter('followUp', e.target.value || undefined)}
          aria-label="Follow-up"
        >
          <option value="">Any follow-up</option>
          <option value="due">Follow-up due</option>
          <option value="none">Never contacted</option>
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
        onRowClick={setOpen}
        empty={<EmptyState title="Nothing outstanding" description="No dues match these filters." />}
      />
      <DueSheet due={open} onClose={() => setOpen(null)} />
    </>
  );
}

function DueSheet({ due, onClose }: { due: Due | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [type, setType] = React.useState<string>('call');
  const [note, setNote] = React.useState('');
  const [promised, setPromised] = React.useState('');
  const [promisedOn, setPromisedOn] = React.useState('');
  const [nextOn, setNextOn] = React.useState('');
  const [paying, setPaying] = React.useState(false);
  React.useEffect(() => {
    setType('call');
    setNote('');
    setPromised('');
    setPromisedOn('');
    setNextOn('');
  }, [due]);
  const history = useQuery({
    queryKey: ['follow-ups', due?.bookingId],
    queryFn: () => api.get<FollowUp[]>('/post-sales/follow-ups', { bookingId: due!.bookingId }),
    enabled: !!due,
  });
  const promisedOk = rupeeField('Amount', { required: false }).safeParse(promised).success;
  const save = useMutation({
    mutationFn: () =>
      api.post('/post-sales/follow-ups', {
        bookingId: due!.bookingId,
        type,
        note,
        promisedAmountPaise: promised ? toPaise(promised) : undefined,
        promisedOn: promisedOn || undefined,
        nextFollowUpOn: nextOn || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['follow-ups', due?.bookingId] });
      qc.invalidateQueries({ queryKey: ['dues'] });
      setNote('');
      setPromised('');
      setPromisedOn('');
      setNextOn('');
      toast.success('Follow-up logged');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Sheet open={!!due} onOpenChange={(o) => !o && onClose()}>
      <SheetContent title={due?.customer?.name ?? ''} description={`${due?.booking?.bookingNumber ?? ''} · ${due?.customer?.phone ?? ''}`}>
        {due && (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Overdue</p>
                <p className="font-semibold text-destructive tabular">{formatINR(due.overduePaise)}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Next 30 days</p>
                <p className="font-semibold tabular">{formatINR(due.upcomingPaise)}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Outstanding</p>
                <p className="font-semibold tabular">{formatINR(due.outstandingPaise)}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <a href={`tel:${due.customer?.phone ?? ''}`}>
                <Button variant="outline" size="sm" type="button">
                  <PhoneCall /> Call
                </Button>
              </a>
              <WhatsAppButton entityType="booking" entityId={due.bookingId} categories={['payment_reminder', 'demand']} label="Reminder" />
              {can('payments.create') && (
                <Button size="sm" variant="outline" onClick={() => setPaying(true)}>
                  <ReceiptIndianRupee /> Record receipt
                </Button>
              )}
              {can('postSales.create') && (
                <Link to="/post-sales/demand-letters">
                  <Button size="sm" variant="outline" type="button">
                    <FilePlus2 /> Demand letter
                  </Button>
                </Link>
              )}
              <Link to={`/post-sales/bookings/${due.bookingId}`} className="self-center text-sm text-primary hover:underline">
                Open booking
              </Link>
            </div>
            {can('collections.create') && (
              <div className="space-y-3 rounded-lg border p-4">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <MessageSquarePlus className="size-4" /> Log a follow-up
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Type" htmlFor="fu-type">
                    <Select value={type} onChange={(e) => setType(e.target.value)}>
                      {FOLLOWUP_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {titleCase(t)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Next follow-up" htmlFor="fu-next">
                    <Input type="date" value={nextOn} min={todayInIndia()} onChange={(e) => setNextOn(e.target.value)} />
                  </Field>
                  <Field label="What happened" htmlFor="fu-note" required className="sm:col-span-2">
                    <Textarea
                      rows={2}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Spoke to customer; will pay after salary"
                    />
                  </Field>
                  <Field label="Promised amount" htmlFor="fu-amt" error={promisedOk ? undefined : 'Enter an amount'}>
                    <MoneyInput value={promised} onChange={(e) => setPromised(e.target.value)} />
                  </Field>
                  <Field label="Promised by" htmlFor="fu-pdate">
                    <Input type="date" value={promisedOn} onChange={(e) => setPromisedOn(e.target.value)} />
                  </Field>
                </div>
                <Button size="sm" loading={save.isPending} disabled={!note.trim() || !promisedOk} onClick={() => save.mutate()}>
                  Save follow-up
                </Button>
              </div>
            )}
            <div>
              <p className="mb-2 text-sm font-semibold">History</p>
              {!history.data?.length ? (
                <p className="text-sm text-muted-foreground">{history.isPending ? 'Loading…' : 'No follow-ups yet.'}</p>
              ) : (
                <ol className="space-y-3">
                  {history.data.map((f) => (
                    <li key={f.id} className="border-l-2 border-primary/40 pl-3 text-sm">
                      <p>
                        <span className="font-medium">{titleCase(f.type)}</span> · {f.note}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {f.createdBy?.name} · {formatDateTime(f.createdAt)}
                        {f.promisedAmountPaise
                          ? ` · promised ${formatINR(f.promisedAmountPaise)}${f.promisedOn ? ` by ${formatDate(f.promisedOn.slice(0, 10))}` : ''}`
                          : ''}
                        {f.nextFollowUpOn ? ` · next ${formatDate(f.nextFollowUpOn.slice(0, 10))}` : ''}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}
      </SheetContent>
      {due && (
        <RecordPaymentDialog
          open={paying}
          onOpenChange={(o) => {
            setPaying(o);
            if (!o) qc.invalidateQueries({ queryKey: ['dues'] });
          }}
          booking={{ id: due.bookingId, bookingNumber: due.booking?.bookingNumber ?? '', outstandingPaise: due.outstandingPaise }}
          canSeeAccounts={can('accounting.read')}
        />
      )}
    </Sheet>
  );
}
