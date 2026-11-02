import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { api } from '@/lib/api';
import { formatINR } from '@/lib/format';
import { useAuth } from '@/features/auth/auth-context';
import { useDebounced } from '@/hooks/use-list-params';
import { paiseToInput } from './money';

export interface ChargeRow {
  name: string;
  amount: string;
  /** Set when the row comes from the charge master; its amount follows the selected units. */
  masterId?: string;
}
interface Computed {
  id: string;
  name: string;
  kind: string;
  isMandatory: boolean;
  amountPaise: number;
}

/**
 * Offers the charge master (PLC, club, maintenance…) priced for the selected units. Mandatory
 * charges are added automatically; amounts follow the unit selection.
 */
export function ChargePicker({
  projectId,
  plotIds,
  charges,
  setCharges,
}: {
  projectId: string;
  plotIds: string[];
  charges: ChargeRow[];
  setCharges: React.Dispatch<React.SetStateAction<ChargeRow[]>>;
}) {
  const { can } = useAuth();
  const units = useDebounced(plotIds.join(','), 300);
  const q = useQuery({
    queryKey: ['charges', 'compute', projectId, units],
    queryFn: () => api.post<Computed[]>('/charges/compute', { projectId, plotIds: units ? units.split(',') : [] }),
    enabled: Boolean(projectId) && Boolean(units) && can('masters.read'),
  });
  const dismissed = React.useRef(new Set<string>());

  // Keep master-linked rows priced for the current units; add mandatory ones.
  React.useEffect(() => {
    if (!q.data) return;
    setCharges((rows) => {
      const byId = new Map(q.data.map((c) => [c.id, c]));
      const next = rows
        .filter((r) => !r.masterId || byId.has(r.masterId))
        .map((r) => (r.masterId ? { ...r, name: byId.get(r.masterId)!.name, amount: paiseToInput(byId.get(r.masterId)!.amountPaise) } : r));
      for (const c of q.data) {
        if (c.isMandatory && !dismissed.current.has(c.id) && !next.some((r) => r.masterId === c.id))
          next.push({ name: c.name, amount: paiseToInput(c.amountPaise), masterId: c.id });
      }
      return JSON.stringify(next) === JSON.stringify(rows) ? rows : next;
    });
  }, [q.data, setCharges]);

  if (!q.data?.length) return null;
  const toggle = (c: Computed) => {
    const on = charges.some((r) => r.masterId === c.id);
    if (on) dismissed.current.add(c.id);
    else dismissed.current.delete(c.id);
    setCharges((rows) =>
      on ? rows.filter((r) => r.masterId !== c.id) : [...rows, { name: c.name, amount: paiseToInput(c.amountPaise), masterId: c.id }],
    );
  };
  return (
    <div className="mb-3">
      <p className="mb-1.5 text-xs text-muted-foreground">From charge master (priced for the selected units):</p>
      <div className="flex flex-wrap gap-2">
        {q.data.map((c) => {
          const on = charges.some((r) => r.masterId === c.id);
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(c)}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${on ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted'}`}
            >
              {on && <Check className="size-3" />}
              {c.name} · {formatINR(c.amountPaise, { decimals: false })}
              {c.isMandatory && <span className="opacity-60">(standard)</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
