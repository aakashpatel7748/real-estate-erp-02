import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Car, Link2, Plus, Rows3, Trash2, Unlink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { PARKING_STATUSES, PARKING_TYPES } from '@erp/shared';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { formatINR, titleCase } from '@/lib/format';
import { useListParams } from '@/hooks/use-list-params';
import { useProjectContext } from '@/hooks/use-project';
import { useAuth } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Badge, Select, Textarea } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/overlays';
import { DataTable, type Column } from '@/components/data-table';
import { Field, PageHeader, StatCard } from '@/components/common';
import { EmptyState } from '@/components/states';
import { SearchInput } from '@/components/search-input';
import { FormFields, type FieldDef } from '@/components/master-crud';
import { BookingPicker, type BookingOption } from '@/components/pickers';
import { toPaise } from '@/components/money';

interface Slot {
  id: string;
  code: string;
  type: string;
  level?: string;
  pricePaise: number;
  status: 'available' | 'allotted' | 'blocked';
  remarks?: string;
  projectId?: { id: string; name: string; code: string };
  blockId?: { id: string; name: string; code: string };
  bookingId?: { id: string; bookingNumber: string };
  customerId?: { id: string; name: string; phone: string };
}
interface Summary {
  available: number;
  allotted: number;
  blocked: number;
  total: number;
}
const VARIANT = { available: 'success', allotted: 'info', blocked: 'muted' } as const;

function useBlocks(projectId: string) {
  return useQuery({
    queryKey: ['project', projectId, 'blocks'],
    queryFn: () => api.get<{ blocks: { id: string; name: string; code: string }[] }>(`/projects/${projectId}`),
    enabled: Boolean(projectId),
    select: (p) => p.blocks ?? [],
  });
}

export function ParkingPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { projectId } = useProjectContext();
  const lp = useListParams({ sort: 'code' });
  const status = lp.filter('status');
  const type = lp.filter('type');
  const query = { ...lp.query, projectId: projectId ?? undefined, status, type };
  const q = useQuery({ queryKey: ['parking', query], queryFn: () => api.page<Slot>('/parking', query) });
  const summary = useQuery({
    queryKey: ['parking', 'summary', projectId],
    queryFn: () => api.get<Summary>('/parking/summary', { projectId: projectId ?? undefined }),
  });
  const [create, setCreate] = React.useState<'one' | 'bulk' | null>(null);
  const [allot, setAllot] = React.useState<Slot | null>(null);
  const [action, setAction] = React.useState<{ slot: Slot; kind: 'release' | 'block' | 'unblock' | 'delete' } | null>(null);
  const [note, setNote] = React.useState('');
  const invalidate = () => qc.invalidateQueries({ queryKey: ['parking'] });
  const act = useMutation({
    mutationFn: ({ slot, kind }: { slot: Slot; kind: string }) => {
      if (kind === 'delete') return api.delete(`/parking/${slot.id}`);
      if (kind === 'release') return api.post(`/parking/${slot.id}/release`, { note });
      return api.post(`/parking/${slot.id}/block`, { blocked: kind === 'block', note });
    },
    onSuccess: () => {
      invalidate();
      setAction(null);
      setNote('');
      toast.success('Parking updated');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const columns: Column<Slot>[] = [
    { key: 'code', header: 'Slot', sortKey: 'code', cell: (s) => <span className="font-medium">{s.code}</span> },
    { key: 'project', header: 'Project', cell: (s) => s.projectId?.name ?? '—' },
    { key: 'where', header: 'Tower / level', cell: (s) => [s.blockId?.name, s.level].filter(Boolean).join(' · ') || '—' },
    { key: 'type', header: 'Type', sortKey: 'type', cell: (s) => titleCase(s.type) },
    {
      key: 'price',
      header: 'Price',
      sortKey: 'pricePaise',
      align: 'right',
      cell: (s) => <span className="tabular">{s.pricePaise ? formatINR(s.pricePaise) : '—'}</span>,
    },
    { key: 'status', header: 'Status', sortKey: 'status', cell: (s) => <Badge variant={VARIANT[s.status]}>{titleCase(s.status)}</Badge> },
    {
      key: 'booking',
      header: 'Allotted to',
      cell: (s) =>
        s.bookingId ? (
          <span>
            <Link
              to={`/post-sales/bookings/${s.bookingId.id}`}
              className="font-medium text-primary hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {s.bookingId.bookingNumber}
            </Link>{' '}
            <span className="text-muted-foreground">{s.customerId?.name}</span>
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (s) =>
        can('inventory.status') && (
          <div className="flex justify-end gap-1">
            {s.status === 'available' && (
              <>
                <Button size="sm" variant="outline" onClick={() => setAllot(s)}>
                  <Link2 /> Allot
                </Button>
                <Button size="icon-sm" variant="ghost" onClick={() => setAction({ slot: s, kind: 'block' })} aria-label={`Block ${s.code}`}>
                  <Ban />
                </Button>
              </>
            )}
            {s.status === 'allotted' && (
              <Button size="sm" variant="outline" onClick={() => setAction({ slot: s, kind: 'release' })}>
                <Unlink /> Release
              </Button>
            )}
            {s.status === 'blocked' && (
              <Button size="sm" variant="outline" onClick={() => setAction({ slot: s, kind: 'unblock' })}>
                Unblock
              </Button>
            )}
            {s.status !== 'allotted' && can('inventory.delete') && (
              <Button size="icon-sm" variant="ghost" onClick={() => setAction({ slot: s, kind: 'delete' })} aria-label={`Delete ${s.code}`}>
                <Trash2 />
              </Button>
            )}
          </div>
        ),
    },
  ];
  const sm = summary.data;
  return (
    <>
      <PageHeader
        title="Parking Slots"
        description="Covered, open, stilt and basement parking, allotted to bookings"
        actions={
          can('inventory.create') && (
            <>
              <Button variant="outline" onClick={() => setCreate('bulk')}>
                <Rows3 /> Add in bulk
              </Button>
              <Button onClick={() => setCreate('one')}>
                <Plus /> New slot
              </Button>
            </>
          )
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <StatCard label="Total slots" value={sm?.total ?? '—'} icon={Car} loading={summary.isPending} />
        <StatCard label="Available" value={sm?.available ?? '—'} tone="success" loading={summary.isPending} />
        <StatCard label="Allotted" value={sm?.allotted ?? '—'} loading={summary.isPending} />
        <StatCard label="Blocked" value={sm?.blocked ?? '—'} tone="warning" loading={summary.isPending} />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput value={lp.q} onChange={lp.setQ} placeholder="Search slot code" className="w-full sm:w-64" />
        <Select
          className="h-9 w-auto"
          value={status ?? ''}
          onChange={(e) => lp.setFilter('status', e.target.value || undefined)}
          aria-label="Status"
        >
          <option value="">All statuses</option>
          {PARKING_STATUSES.map((s) => (
            <option key={s} value={s}>
              {titleCase(s)}
            </option>
          ))}
        </Select>
        <Select
          className="h-9 w-auto"
          value={type ?? ''}
          onChange={(e) => lp.setFilter('type', e.target.value || undefined)}
          aria-label="Type"
        >
          <option value="">All types</option>
          {PARKING_TYPES.map((s) => (
            <option key={s} value={s}>
              {titleCase(s)}
            </option>
          ))}
        </Select>
      </div>
      <DataTable
        columns={columns}
        rows={q.data?.items}
        rowKey={(s) => s.id}
        loading={q.isPending}
        error={q.error}
        onRetry={() => q.refetch()}
        meta={q.data?.meta}
        onPageChange={lp.setPage}
        pageSize={lp.pageSize}
        onPageSizeChange={lp.setPageSize}
        sort={lp.sort}
        onSortChange={lp.setSort}
        empty={<EmptyState title="No parking slots" description="Add slots one by one or in bulk (e.g. C-1 to C-120)." />}
      />
      <CreateParkingDialog mode={create} onClose={() => setCreate(null)} />
      <AllotDialog slot={allot} onClose={() => setAllot(null)} />
      <Dialog open={!!action} onOpenChange={(o) => !o && setAction(null)}>
        <DialogContent
          title={
            action?.kind === 'delete'
              ? `Delete slot ${action.slot.code}?`
              : action?.kind === 'release'
                ? `Release ${action?.slot.code} from ${action?.slot.bookingId?.bookingNumber}?`
                : `${titleCase(action?.kind ?? '')} slot ${action?.slot.code}?`
          }
        >
          {action?.kind !== 'delete' && (
            <Field label="Reason" htmlFor="pk-note" required>
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)}>
              Cancel
            </Button>
            <Button
              variant={action?.kind === 'delete' ? 'destructive' : 'default'}
              loading={act.isPending}
              disabled={action?.kind !== 'delete' && !note.trim()}
              onClick={() => action && act.mutate(action)}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CreateParkingDialog({ mode, onClose }: { mode: 'one' | 'bulk' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { projectId } = useProjectContext();
  const [values, setValues] = React.useState<Record<string, unknown>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    if (mode) {
      setValues({
        projectId: projectId ?? '',
        type: 'covered',
        code: '',
        prefix: 'P-',
        startNumber: '1',
        count: '20',
        price: '',
        level: '',
        blockId: '',
      });
      setErrors({});
    }
  }, [mode, projectId]);
  const blocks = useBlocks(String(values.projectId ?? ''));
  const fields: FieldDef[] = [
    { name: 'projectId', label: 'Project', type: 'project', required: true },
    {
      name: 'blockId',
      label: 'Tower / block',
      type: 'select',
      options: (blocks.data ?? []).map((b) => ({ value: b.id, label: b.name })),
      emptyLabel: 'None',
    },
    ...(mode === 'bulk'
      ? ([
          { name: 'prefix', label: 'Code prefix', type: 'upper' },
          { name: 'startNumber', label: 'Start number', type: 'number', required: true },
          { name: 'count', label: 'How many', type: 'number', required: true },
        ] as FieldDef[])
      : ([{ name: 'code', label: 'Slot code', type: 'upper', required: true, placeholder: 'B1-014' }] as FieldDef[])),
    { name: 'type', label: 'Type', type: 'select', required: true, options: PARKING_TYPES },
    { name: 'level', label: 'Level', type: 'text', placeholder: 'B1, Stilt…' },
    { name: 'price', label: 'Price', type: 'money' },
  ];
  const save = useMutation({
    mutationFn: () => {
      const base = {
        projectId: values.projectId,
        blockId: values.blockId || undefined,
        type: values.type,
        level: values.level || undefined,
        pricePaise: values.price ? toPaise(String(values.price)) : 0,
      };
      return mode === 'bulk'
        ? api.post<{ created: number }>('/parking/bulk', {
            ...base,
            prefix: String(values.prefix ?? '').toUpperCase(),
            startNumber: Number(values.startNumber),
            count: Number(values.count),
          })
        : api.post('/parking', { ...base, code: String(values.code).toUpperCase() });
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['parking'] });
      toast.success(mode === 'bulk' ? `${(r as { created: number }).created} slots added` : 'Slot added');
      onClose();
    },
    onError: (e) => {
      setErrors(fieldErrors(e));
      toast.error(errorMessage(e));
    },
  });
  const preview =
    mode === 'bulk' && Number(values.count) > 0
      ? `${String(values.prefix ?? '').toUpperCase()}${values.startNumber} … ${String(values.prefix ?? '').toUpperCase()}${Number(values.startNumber) + Number(values.count) - 1}`
      : '';
  return (
    <Dialog open={!!mode} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={mode === 'bulk' ? 'Add parking slots in bulk' : 'New parking slot'} className="max-w-xl">
        <FormFields fields={fields} values={values} onChange={setValues} errors={errors} idPrefix="pk" />
        {preview && <p className="text-sm text-muted-foreground">Creates slots {preview}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!values.projectId} onClick={() => save.mutate()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AllotDialog({ slot, onClose }: { slot: Slot | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [booking, setBooking] = React.useState<BookingOption | null>(null);
  React.useEffect(() => setBooking(null), [slot]);
  const save = useMutation({
    mutationFn: () => api.post(`/parking/${slot!.id}/allot`, { bookingId: booking!.id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['parking'] });
      toast.success(`${slot?.code} allotted to ${booking?.bookingNumber}`);
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={!!slot} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`Allot ${slot?.code ?? ''}`}
        description={`${slot?.projectId?.name ?? ''} · ${titleCase(slot?.type ?? '')}${slot?.pricePaise ? ` · ${formatINR(slot.pricePaise)}` : ''}`}
      >
        <Field label="Booking" htmlFor="pk-booking" required hint="Only bookings in the same project can be chosen">
          <BookingPicker id="pk-booking" value={booking} onChange={setBooking} projectId={slot?.projectId?.id} />
        </Field>
        {slot?.pricePaise ? (
          <p className="text-xs text-muted-foreground">
            If parking is chargeable, add it to the booking’s charges or raise a debit note in Ledger Adjustment.
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!booking} onClick={() => save.mutate()}>
            Allot
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
