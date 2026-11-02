import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { api } from '@/lib/api';
import { formatINR } from '@/lib/format';
import { useDebounced } from '@/hooks/use-list-params';
import { useProjectContext } from '@/hooks/use-project';
import { Input, Select } from './ui/primitives';
import { Button } from './ui/button';

export interface BookingOption {
  id: string;
  bookingNumber: string;
  status: string;
  netAmountPaise: number;
  allocatedPaise: number;
  plots?: string[];
  customerId?: { id: string; name: string; phone: string };
  projectId?: { id: string; name: string; code: string };
}

/** Type-ahead booking search (number, customer name or phone). */
export function BookingPicker({
  id,
  value,
  onChange,
  statuses = ['booked', 'reserved'],
  projectId,
}: {
  id?: string;
  value: BookingOption | null;
  onChange: (b: BookingOption | null) => void;
  statuses?: string[];
  projectId?: string;
}) {
  const [q, setQ] = React.useState('');
  const debounced = useDebounced(q.trim(), 250);
  const results = useQuery({
    queryKey: ['bookings', 'picker', debounced, projectId, statuses.join()],
    queryFn: () => api.page<BookingOption>('/bookings', { q: debounced || undefined, pageSize: 20, sort: '-createdAt', projectId }),
    enabled: !value,
    select: (r) => r.items.filter((b) => statuses.includes(b.status)),
  });
  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm" id={id}>
        <div className="min-w-0">
          <p className="truncate font-medium">
            {value.bookingNumber} · {value.customerId?.name}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {value.projectId?.name} {value.plots?.length ? `· Units ${value.plots.join(', ')}` : ''} · Due{' '}
            {formatINR(value.netAmountPaise - value.allocatedPaise)}
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" onClick={() => onChange(null)} aria-label="Change booking">
          <X />
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-2" id={id}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search booking no., customer or phone"
          className="pl-8"
          aria-label="Search bookings"
        />
      </div>
      <div className="max-h-48 overflow-y-auto rounded-md border">
        {results.isPending ? (
          <p className="p-3 text-sm text-muted-foreground">Searching…</p>
        ) : !results.data?.length ? (
          <p className="p-3 text-sm text-muted-foreground">No matching active bookings</p>
        ) : (
          results.data.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => onChange(b)}
              className="flex w-full cursor-pointer items-center justify-between gap-3 border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-muted"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {b.bookingNumber} · {b.customerId?.name}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {b.projectId?.code} {b.plots?.length ? `· ${b.plots.join(', ')}` : ''}
                </span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular">{formatINR(b.netAmountPaise - b.allocatedPaise)} due</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export interface AccountOption {
  id: string;
  code: string;
  name: string;
  type: string;
  systemKey?: string;
  isBank?: boolean;
  isActive: boolean;
}

export function useAccounts(enabled = true) {
  return useQuery({ queryKey: ['accounts'], queryFn: () => api.get<AccountOption[]>('/accounting/accounts'), enabled });
}

const CONTROL = ['customer_receivable', 'customer_advance', 'refund_payable', 'vendor_payable', 'broker_payable'];

/** Chart-of-accounts select filtered by type; control and GST accounts are excluded. */
export function AccountSelect({
  id,
  value,
  onChange,
  types,
  placeholder = 'Choose account',
  cashBankOnly,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  types?: string[];
  placeholder?: string;
  cashBankOnly?: boolean;
}) {
  const accounts = useAccounts();
  const rows = (accounts.data ?? []).filter((a) => {
    if (!a.isActive) return false;
    if (cashBankOnly) return a.type === 'asset' && (a.systemKey === 'cash' || a.systemKey === 'bank' || a.isBank || !a.systemKey);
    if (a.systemKey && (CONTROL.includes(a.systemKey) || a.systemKey.startsWith('gst_'))) return false;
    return !types || types.includes(a.type);
  });
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {rows.map((a) => (
        <option key={a.id} value={a.id}>
          {a.code} · {a.name}
        </option>
      ))}
    </Select>
  );
}

/** Project select from the projects the user can access. */
export function ProjectSelect({
  id,
  value,
  onChange,
  allowAll,
  allLabel = 'All projects',
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  allowAll?: boolean;
  allLabel?: string;
}) {
  const { projects } = useProjectContext();
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {allowAll ? <option value="">{allLabel}</option> : <option value="">Choose project</option>}
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </Select>
  );
}

/** Checkbox list of projects (multi-select). */
export function ProjectMultiSelect({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { projects } = useProjectContext();
  if (!projects.length) return <p className="text-sm text-muted-foreground">No projects yet</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {projects.map((p) => {
        const on = value.includes(p.id);
        return (
          <button
            key={p.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== p.id) : [...value, p.id])}
            className={`cursor-pointer rounded-full border px-3 py-1 text-xs transition-colors ${on ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
          >
            {p.name}
          </button>
        );
      })}
    </div>
  );
}
