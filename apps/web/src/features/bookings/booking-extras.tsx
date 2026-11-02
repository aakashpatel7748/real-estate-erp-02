import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Banknote, Car, FileSignature, KeyRound, Landmark, MinusCircle, Pencil, ScrollText } from 'lucide-react';
import { toast } from 'sonner';
import { LOAN_STATUSES } from '@erp/shared';
import { api, errorMessage } from '@/lib/api';
import { formatDate, formatINR, titleCase } from '@/lib/format';
import { useAuth } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardHeader, CardTitle, Input, Select } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/overlays';
import { Field, StatusBadge } from '@/components/common';
import { MoneyInput, paiseToInput, rupeeField, toPaise } from '@/components/money';

export interface BookingLoan {
  financerId?: string;
  status?: string;
  loanAccountNo?: string;
  sanctionedPaise?: number;
  disbursedPaise?: number;
  sanctionDate?: string;
  remarks?: string;
}

interface Doc {
  id: string;
  kind: 'agreement' | 'registry' | 'possession' | 'demand';
  number: string;
  status: string;
  date: string;
}
const DOC_LINKS = [
  { kind: 'agreement', label: 'Builder buyer agreement', path: '/post-sales/agreements', icon: FileSignature },
  { kind: 'demand', label: 'Demand letters', path: '/post-sales/demand-letters', icon: ScrollText },
  { kind: 'registry', label: 'Sale deed registry', path: '/post-sales/registry', icon: Landmark },
  { kind: 'possession', label: 'Possession', path: '/post-sales/possession-letters', icon: KeyRound },
] as const;

/** Home loan + post-sales documents + parking for a booking. */
export function BookingExtras({ bookingId, loan, active }: { bookingId: string; loan?: BookingLoan; active: boolean }) {
  const { can } = useAuth();
  const [editing, setEditing] = React.useState(false);
  const financers = useQuery({
    queryKey: ['financers', 'options'],
    queryFn: () => api.page<{ id: string; name: string; branch?: string }>('/financers', { pageSize: 100 }),
    enabled: can('masters.read'),
    select: (r) => r.items,
  });
  const docs = useQuery({
    queryKey: ['sales-docs', 'booking', bookingId],
    queryFn: async () => {
      const kinds = ['agreement', 'registry', 'possession', 'demand'] as const;
      const all = await Promise.all(kinds.map((kind) => api.page<Doc>('/post-sales/documents', { kind, bookingId, pageSize: 5 })));
      return all.flatMap((r) => r.items.map((d) => d));
    },
    enabled: can('postSales.read'),
  });
  const parking = useQuery({
    queryKey: ['parking', 'booking', bookingId],
    queryFn: () =>
      api.page<{ id: string; code: string; type: string; bookingId?: { id: string } }>('/parking', { status: 'allotted', pageSize: 100 }),
    enabled: can('inventory.read'),
    select: (r) => r.items.filter((p) => p.bookingId?.id === bookingId),
  });
  const lender = financers.data?.find((f) => f.id === loan?.financerId);
  return (
    <>
      {(can('masters.read') || loan?.financerId) && (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Banknote className="size-4 text-muted-foreground" /> Home loan
            </CardTitle>
            {active && can('postSales.update') && (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Pencil /> {loan?.financerId ? 'Update' : 'Add'}
              </Button>
            )}
          </CardHeader>
          <CardContent className="text-sm">
            {loan?.financerId ? (
              <div className="space-y-1">
                <p className="flex items-center gap-2 font-medium">
                  {lender ? `${lender.name}${lender.branch ? `, ${lender.branch}` : ''}` : 'Lender'}{' '}
                  {loan.status && <StatusBadge status={loan.status} />}
                </p>
                <p className="text-muted-foreground">
                  {loan.sanctionedPaise ? `Sanctioned ${formatINR(loan.sanctionedPaise)}` : 'Not sanctioned yet'}
                  {loan.disbursedPaise ? ` · disbursed ${formatINR(loan.disbursedPaise)}` : ''}
                  {loan.sanctionDate ? ` · ${formatDate(loan.sanctionDate.slice(0, 10))}` : ''}
                </p>
                {loan.loanAccountNo && <p className="text-muted-foreground">Loan a/c {loan.loanAccountNo}</p>}
              </div>
            ) : (
              <p className="text-muted-foreground">Self-funded (no home loan recorded)</p>
            )}
          </CardContent>
        </Card>
      )}
      {can('postSales.read') && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Post sales</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {DOC_LINKS.map((l) => {
              const mine = (docs.data ?? []).filter((d) => d.kind === l.kind && d.status !== 'cancelled');
              const Icon = l.icon;
              return (
                <div key={l.kind} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <Icon className="size-4 text-muted-foreground" /> {l.label}
                  </span>
                  {mine.length ? (
                    <span className="flex flex-wrap justify-end gap-1">
                      {mine.slice(0, 2).map((d) => (
                        <Link key={d.id} to={`${l.path}/${d.id}`} className="text-primary hover:underline">
                          <Badge variant="outline">{l.kind === 'demand' ? formatDate(d.date.slice(0, 10)) : titleCase(d.status)}</Badge>
                        </Link>
                      ))}
                    </span>
                  ) : (
                    <Link to={l.path} className="text-xs text-muted-foreground hover:text-foreground">
                      None · create
                    </Link>
                  )}
                </div>
              );
            })}
            {can('accounting.adjust') && active && (
              <Link to="/account/ledger-adjustment" className="flex items-center gap-2 pt-1 text-xs text-primary hover:underline">
                <MinusCircle className="size-3.5" /> Credit / debit note for this booking
              </Link>
            )}
            {!!parking.data?.length && (
              <p className="flex items-center gap-2 border-t pt-2">
                <Car className="size-4 text-muted-foreground" /> Parking{' '}
                {parking.data.map((p) => `${p.code} (${titleCase(p.type)})`).join(', ')}
              </p>
            )}
          </CardContent>
        </Card>
      )}
      <LoanDialog open={editing} onOpenChange={setEditing} bookingId={bookingId} loan={loan} financers={financers.data ?? []} />
    </>
  );
}

function LoanDialog({
  open,
  onOpenChange,
  bookingId,
  loan,
  financers,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  bookingId: string;
  loan?: BookingLoan;
  financers: { id: string; name: string; branch?: string }[];
}) {
  const qc = useQueryClient();
  const [v, setV] = React.useState({
    financerId: '',
    status: 'applied',
    loanAccountNo: '',
    sanctioned: '',
    disbursed: '',
    sanctionDate: '',
  });
  React.useEffect(() => {
    if (open)
      setV({
        financerId: loan?.financerId ?? '',
        status: loan?.status ?? 'applied',
        loanAccountNo: loan?.loanAccountNo ?? '',
        sanctioned: paiseToInput(loan?.sanctionedPaise),
        disbursed: paiseToInput(loan?.disbursedPaise),
        sanctionDate: loan?.sanctionDate?.slice(0, 10) ?? '',
      });
  }, [open, loan]);
  const money = rupeeField('Amount', { required: false });
  const ok = money.safeParse(v.sanctioned).success && money.safeParse(v.disbursed).success;
  const save = useMutation({
    mutationFn: (remove: boolean) =>
      api.put(
        `/post-sales/bookings/${bookingId}/loan`,
        remove
          ? null
          : {
              financerId: v.financerId,
              status: v.status,
              loanAccountNo: v.loanAccountNo || undefined,
              sanctionedPaise: v.sanctioned ? toPaise(v.sanctioned) : undefined,
              disbursedPaise: v.disbursed ? toPaise(v.disbursed) : undefined,
              sanctionDate: v.sanctionDate || undefined,
            },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['booking', bookingId] });
      qc.invalidateQueries({ queryKey: ['financers'] });
      toast.success('Home loan saved');
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const set = (k: keyof typeof v, val: string) => setV((s) => ({ ...s, [k]: val }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Home loan">
        {!financers.length ? (
          <p className="text-sm text-muted-foreground">
            Add lenders first under{' '}
            <Link to="/master/banks-financers" className="text-primary hover:underline">
              Master → Banks & Home Loan Financers
            </Link>
            .
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Lender" htmlFor="ln-fin" required className="sm:col-span-2">
              <Select value={v.financerId} onChange={(e) => set('financerId', e.target.value)}>
                <option value="">Choose…</option>
                {financers.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                    {f.branch ? `, ${f.branch}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Status" htmlFor="ln-status">
              <Select value={v.status} onChange={(e) => set('status', e.target.value)}>
                {LOAN_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {titleCase(st)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Loan account no." htmlFor="ln-acc">
              <Input value={v.loanAccountNo} onChange={(e) => set('loanAccountNo', e.target.value)} />
            </Field>
            <Field label="Sanctioned" htmlFor="ln-sanc">
              <MoneyInput value={v.sanctioned} onChange={(e) => set('sanctioned', e.target.value)} />
            </Field>
            <Field label="Disbursed" htmlFor="ln-disb">
              <MoneyInput value={v.disbursed} onChange={(e) => set('disbursed', e.target.value)} />
            </Field>
            <Field label="Sanction date" htmlFor="ln-date">
              <Input type="date" value={v.sanctionDate} onChange={(e) => set('sanctionDate', e.target.value)} />
            </Field>
          </div>
        )}
        <DialogFooter>
          {loan?.financerId && (
            <Button variant="ghost" className="mr-auto text-destructive" loading={save.isPending} onClick={() => save.mutate(true)}>
              Remove loan
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!v.financerId || !ok} onClick={() => save.mutate(false)}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
