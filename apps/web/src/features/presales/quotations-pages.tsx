import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight, Ban, CheckCircle2, FileDown, Plus, Send, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { addDays, areaToSqft, QUOTATION_STATUSES, todayInIndia } from '@erp/shared';
import { api, download, errorMessage } from '@/lib/api';
import { formatDate, formatINR, titleCase } from '@/lib/format';
import { useDebounced, useListParams } from '@/hooks/use-list-params';
import { useProjectContext } from '@/hooks/use-project';
import { Can, useAuth } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardHeader, CardTitle, Input, Select, Textarea, type BadgeVariant } from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/overlays';
import { DataTable, type Column } from '@/components/data-table';
import { DescriptionList, Field, PageHeader } from '@/components/common';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/states';
import { SearchInput } from '@/components/search-input';
import { MoneyInput, toPaise } from '@/components/money';
import { ChargePicker, type ChargeRow } from '@/components/charge-picker';
import { WhatsAppButton } from '@/components/whatsapp-button';

interface QuoteItem {
  plotId: string;
  plotNumber: string;
  blockCode?: string;
  areaX100: number;
  ratePaisePerSqft: number;
  plcPaise: number;
  lineTotalPaise: number;
}
interface Quotation {
  id: string;
  number: string;
  status: (typeof QUOTATION_STATUSES)[number];
  quoteDate: string;
  validUntil: string;
  planName: string;
  prospectName?: string;
  prospectPhone?: string;
  plotIds: string[];
  paymentPlanId: string;
  items: QuoteItem[];
  grossAmountPaise: number;
  discountPaise: number;
  charges: { name: string; amountPaise: number }[];
  chargesTotalPaise: number;
  netAmountPaise: number;
  schedule?: { sequence: number; name: string; dueDate: string; amountPaise: number }[];
  notes?: string;
  projectId?: { id: string; name: string; code: string };
  leadId?: { id: string; name: string; phone: string };
  customerId?: { id: string; name: string; phone: string };
  bookingId?: { id: string; bookingNumber: string };
  createdBy?: { name: string };
}

const VARIANT: Record<string, BadgeVariant> = { draft: 'muted', sent: 'info', accepted: 'success', converted: 'violet', expired: 'warning', cancelled: 'destructive' };
const prospect = (q: Quotation) => q.customerId ?? q.leadId ?? (q.prospectName ? { name: q.prospectName, phone: q.prospectPhone ?? '' } : undefined);
const units = (q: Pick<Quotation, 'items'>) => q.items.map((i) => (i.blockCode ? `${i.blockCode}-${i.plotNumber}` : i.plotNumber)).join(', ');

export function QuotationsPage() {
  const navigate = useNavigate();
  const { projectId } = useProjectContext();
  const lp = useListParams({ sort: '-quoteDate' });
  const status = lp.filter('status');
  const query = { ...lp.query, status, projectId: projectId ?? undefined };
  const q = useQuery({ queryKey: ['quotations', query], queryFn: () => api.page<Quotation>('/quotations', query) });
  const columns: Column<Quotation>[] = [
    { key: 'number', header: 'Quotation', sortKey: 'number', cell: (r) => <span className="font-medium">{r.number}</span> },
    { key: 'date', header: 'Date', sortKey: 'quoteDate', cell: (r) => formatDate(r.quoteDate.slice(0, 10)) },
    { key: 'prospect', header: 'For', cell: (r) => <span>{prospect(r)?.name ?? '—'} <span className="text-muted-foreground">{prospect(r)?.phone}</span></span> },
    { key: 'project', header: 'Project / units', cell: (r) => `${r.projectId?.code ?? ''} · ${units(r)}` },
    { key: 'net', header: 'Total', sortKey: 'netAmountPaise', align: 'right', cell: (r) => <span className="tabular">{formatINR(r.netAmountPaise)}</span> },
    { key: 'valid', header: 'Valid until', sortKey: 'validUntil', hideOnMobile: true, cell: (r) => formatDate(r.validUntil.slice(0, 10)) },
    { key: 'status', header: 'Status', cell: (r) => <Badge variant={VARIANT[r.status]}>{titleCase(r.status)}</Badge> },
  ];
  return (
    <>
      <PageHeader
        title="Cost Sheets & Quotations"
        description="Saved, numbered cost sheets with payment schedules. Convert an accepted one into a booking in one step."
        actions={
          <Can permission="quotations.create">
            <Button onClick={() => navigate('/pre-sales/quotations/new')}>
              <Plus /> New quotation
            </Button>
          </Can>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput value={lp.q} onChange={lp.setQ} placeholder="Search number, prospect" className="w-full sm:w-72" />
        <Select className="h-9 w-auto" value={status ?? ''} onChange={(e) => lp.setFilter('status', e.target.value || undefined)} aria-label="Status">
          <option value="">All statuses</option>
          {QUOTATION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {titleCase(s)}
            </option>
          ))}
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
        onRowClick={(r) => navigate(`/pre-sales/quotations/${r.id}`)}
        empty={<EmptyState title="No quotations yet" description="Make a cost sheet for a lead or walk-in prospect and share it as a PDF or on WhatsApp." />}
      />
    </>
  );
}

// ---------------- New quotation ----------------

interface Plot {
  id: string;
  plotNumber: string;
  blockCode?: string;
  areaX100: number;
  listPricePaise: number;
  unitType?: string;
}
interface Person {
  id: string;
  name: string;
  phone: string;
}
interface QuotePreview {
  items: QuoteItem[];
  unavailable: { plotNumber: string; status: string }[];
  grossAmountPaise: number;
  discountPaise: number;
  chargesTotalPaise: number;
  netAmountPaise: number;
  planName: string;
  schedule: { sequence: number; name: string; dueDate: string; amountPaise: number }[];
}

function PersonSearch({ endpoint, onPick, placeholder }: { endpoint: string; onPick: (p: Person) => void; placeholder: string }) {
  const [q, setQ] = React.useState('');
  const d = useDebounced(q.trim(), 250);
  const res = useQuery({ queryKey: [endpoint, 'pick', d], queryFn: () => api.page<Person>(endpoint, { q: d, pageSize: 8 }), enabled: d.length >= 2 });
  return (
    <div className="relative">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} autoComplete="off" />
      {res.data && d.length >= 2 && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border bg-popover p-1 shadow-lg">
          {!res.data.items.length && <p className="px-2 py-1.5 text-sm text-muted-foreground">No match</p>}
          {res.data.items.map((p) => (
            <button key={p.id} type="button" onClick={() => onPick(p)} className="flex w-full cursor-pointer justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted">
              <span>{p.name}</span>
              <span className="text-muted-foreground">{p.phone}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function NewQuotationPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const { projects, projectId: ctxProject } = useProjectContext();
  const [projectId, setProjectId] = React.useState(params.get('project') ?? ctxProject ?? '');
  const [mode, setMode] = React.useState<'lead' | 'customer' | 'walkin'>(params.get('customer') ? 'customer' : 'lead');
  const [lead, setLead] = React.useState<Person | null>(null);
  const [customer, setCustomer] = React.useState<Person | null>(null);
  const [prospectName, setProspectName] = React.useState('');
  const [prospectPhone, setProspectPhone] = React.useState('');
  const [plotIds, setPlotIds] = React.useState<string[]>([]);
  const [plotFilter, setPlotFilter] = React.useState('');
  const [planId, setPlanId] = React.useState('');
  const [quoteDate, setQuoteDate] = React.useState(todayInIndia());
  const [validUntil, setValidUntil] = React.useState('');
  const [discount, setDiscount] = React.useState('');
  const [charges, setCharges] = React.useState<ChargeRow[]>([]);
  const [notes, setNotes] = React.useState('');

  const preLead = params.get('lead');
  const preCustomer = params.get('customer');
  useQuery({
    queryKey: ['lead', preLead, 'quote'],
    queryFn: async () => {
      const l = await api.get<Person & { projectId?: { id: string } }>(`/leads/${preLead}`);
      setLead(l);
      if (l.projectId?.id && !projectId) setProjectId(l.projectId.id);
      return l;
    },
    enabled: Boolean(preLead),
  });
  useQuery({
    queryKey: ['customer', preCustomer, 'quote'],
    queryFn: async () => {
      const c = await api.get<Person>(`/customers/${preCustomer}`);
      setCustomer(c);
      return c;
    },
    enabled: Boolean(preCustomer),
  });
  const plots = useQuery({
    queryKey: ['plots', projectId, 'available'],
    queryFn: () => api.page<Plot>(`/projects/${projectId}/plots`, { status: 'available', pageSize: 100, sort: 'plotNumber' }),
    enabled: Boolean(projectId),
  });
  const plans = useQuery({
    queryKey: ['payment-plans', projectId],
    queryFn: () => api.get<{ id: string; name: string; isActive: boolean }[]>('/payment-plans', { projectId }),
    enabled: Boolean(projectId),
    select: (rows) => rows.filter((p) => p.isActive),
  });

  let discountPaise = 0;
  let chargeRows: { name: string; amountPaise: number }[] = [];
  let inputError: string | null = null;
  try {
    discountPaise = toPaise(discount);
    chargeRows = charges.filter((c) => c.name.trim() || c.amount).map((c) => ({ name: c.name.trim(), amountPaise: toPaise(c.amount) }));
    if (chargeRows.some((c) => !c.name)) inputError = 'Every charge needs a name';
  } catch {
    inputError = 'Check the discount and charge amounts';
  }
  const input = projectId && plotIds.length && planId && !inputError ? { projectId, plotIds, paymentPlanId: planId, bookingDate: quoteDate, discountPaise, charges: chargeRows } : null;
  const debounced = useDebounced(input, 300);
  const preview = useQuery({ queryKey: ['quote', debounced], queryFn: () => api.post<QuotePreview>('/bookings/quote', debounced), enabled: Boolean(debounced), retry: false });

  const who =
    mode === 'lead' ? (lead ? { leadId: lead.id } : null) : mode === 'customer' ? (customer ? { customerId: customer.id } : null) : prospectName.trim() ? { prospectName: prospectName.trim(), prospectPhone: prospectPhone.trim() || undefined } : null;
  const save = useMutation({
    mutationFn: () => api.post<Quotation>('/quotations', { ...input!, bookingDate: undefined, quoteDate, validUntil: validUntil || undefined, notes: notes || undefined, ...who }),
    onSuccess: (q) => {
      qc.invalidateQueries({ queryKey: ['quotations'] });
      toast.success(`Quotation ${q.number} saved`);
      navigate(`/pre-sales/quotations/${q.id}`, { replace: true });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const available = plots.data?.items ?? [];
  const selected = plotIds.map((id) => available.find((p) => p.id === id)).filter(Boolean) as Plot[];
  const filtered = available.filter((p) => !plotIds.includes(p.id) && `${p.blockCode ?? ''}-${p.plotNumber}`.toLowerCase().includes(plotFilter.toLowerCase()));
  const ready = input && who && preview.data && !preview.data.unavailable.length;

  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'Quotations', to: '/pre-sales/quotations' }, { label: 'New quotation' }]} title="New quotation" description="Nothing is held; prices are checked again when the booking is made." />
      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>1. Prospect & project</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2 flex flex-wrap gap-4 text-sm">
                {(['lead', 'customer', 'walkin'] as const).map((m) => (
                  <label key={m} className="flex items-center gap-2">
                    <input type="radio" name="who" checked={mode === m} onChange={() => setMode(m)} /> {m === 'lead' ? 'Lead' : m === 'customer' ? 'Existing customer' : 'Walk-in prospect'}
                  </label>
                ))}
              </div>
              {mode === 'walkin' ? (
                <>
                  <Field label="Prospect name" htmlFor="nq-name" required>
                    <Input value={prospectName} onChange={(e) => setProspectName(e.target.value)} />
                  </Field>
                  <Field label="Phone" htmlFor="nq-phone">
                    <Input type="tel" value={prospectPhone} onChange={(e) => setProspectPhone(e.target.value)} />
                  </Field>
                </>
              ) : (
                <Field label={mode === 'lead' ? 'Lead' : 'Customer'} htmlFor="nq-person" required className="sm:col-span-2">
                  {(mode === 'lead' ? lead : customer) ? (
                    <div className="flex h-9 items-center justify-between rounded-md border bg-muted/50 px-3 text-sm" id="nq-person">
                      <span>
                        {(mode === 'lead' ? lead : customer)!.name} · {(mode === 'lead' ? lead : customer)!.phone}
                      </span>
                      <button type="button" className="cursor-pointer" aria-label="Change" onClick={() => (mode === 'lead' ? setLead(null) : setCustomer(null))}>
                        <X className="size-4" />
                      </button>
                    </div>
                  ) : (
                    <div id="nq-person">
                      <PersonSearch endpoint={mode === 'lead' ? '/leads' : '/customers'} onPick={mode === 'lead' ? setLead : setCustomer} placeholder="Search name or phone…" />
                    </div>
                  )}
                </Field>
              )}
              <Field label="Project" htmlFor="nq-project" required>
                <Select
                  value={projectId}
                  onChange={(e) => {
                    setProjectId(e.target.value);
                    setPlotIds([]);
                    setPlanId('');
                    setCharges((cs) => cs.filter((c) => !c.masterId));
                  }}
                >
                  <option value="">Choose…</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>2. Units</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!projectId ? (
                <p className="text-sm text-muted-foreground">Choose a project first.</p>
              ) : (
                <>
                  {selected.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {selected.map((p) => (
                        <span key={p.id} className="inline-flex items-center gap-1.5 rounded-full border bg-accent px-3 py-1 text-sm">
                          {p.blockCode ? `${p.blockCode}-` : ''}
                          {p.plotNumber} · {areaToSqft(p.areaX100)} sq ft
                          <button type="button" className="cursor-pointer" onClick={() => setPlotIds((ids) => ids.filter((x) => x !== p.id))} aria-label={`Remove ${p.plotNumber}`}>
                            <X className="size-3.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <Input value={plotFilter} onChange={(e) => setPlotFilter(e.target.value)} placeholder="Filter available units…" aria-label="Filter units" />
                  <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4 lg:grid-cols-6">
                    {filtered.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPlotIds((ids) => [...ids, p.id])}
                        className="cursor-pointer rounded-md border border-green-200 bg-green-50 px-2 py-2 text-left text-xs hover:border-green-500 dark:border-green-900 dark:bg-green-950/30"
                      >
                        <span className="block font-semibold">
                          {p.blockCode ? `${p.blockCode}-` : ''}
                          {p.plotNumber}
                        </span>
                        <span className="text-muted-foreground">{areaToSqft(p.areaX100)} sq ft</span>
                      </button>
                    ))}
                    {plots.data && !filtered.length && <p className="col-span-full text-sm text-muted-foreground">No more available units.</p>}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>3. Terms</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Payment plan" htmlFor="nq-plan" required>
                <Select value={planId} onChange={(e) => setPlanId(e.target.value)} disabled={!projectId}>
                  <option value="">Choose…</option>
                  {plans.data?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Quotation date" htmlFor="nq-date" required>
                <Input type="date" value={quoteDate} onChange={(e) => setQuoteDate(e.target.value)} />
              </Field>
              <Field label="Valid until" htmlFor="nq-valid" hint="Defaults to the validity set in Settings">
                <Input type="date" value={validUntil} min={quoteDate} onChange={(e) => setValidUntil(e.target.value)} placeholder={addDays(quoteDate, 15)} />
              </Field>
              {can('bookings.discount') && (
                <Field label="Discount" htmlFor="nq-discount">
                  <MoneyInput value={discount} onChange={(e) => setDiscount(e.target.value)} />
                </Field>
              )}
              <div className="sm:col-span-2">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium">Charges</p>
                  <Button type="button" size="sm" variant="outline" onClick={() => setCharges((c) => [...c, { name: '', amount: '' }])} disabled={charges.length >= 10}>
                    <Plus /> Add charge
                  </Button>
                </div>
                {projectId && <ChargePicker projectId={projectId} plotIds={plotIds} charges={charges} setCharges={setCharges} />}
                {charges.map((c, i) => (
                  <div key={i} className="mb-2 grid grid-cols-[1fr_160px_auto] gap-2">
                    <Input value={c.name} onChange={(e) => setCharges((cs) => cs.map((x, j) => (j === i ? { ...x, name: e.target.value, masterId: undefined } : x)))} placeholder="Charge" aria-label="Charge name" />
                    <MoneyInput value={c.amount} onChange={(e) => setCharges((cs) => cs.map((x, j) => (j === i ? { ...x, amount: e.target.value, masterId: undefined } : x)))} aria-label="Charge amount" />
                    <Button type="button" variant="ghost" size="icon" onClick={() => setCharges((cs) => cs.filter((_, j) => j !== i))} aria-label="Remove charge">
                      <Trash2 />
                    </Button>
                  </div>
                ))}
              </div>
              <Field label="Notes on the cost sheet" htmlFor="nq-notes" className="sm:col-span-2">
                <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Registry charges extra at actuals" />
              </Field>
            </CardContent>
          </Card>
        </div>
        <div className="xl:sticky xl:top-20 xl:self-start">
          <Card>
            <CardHeader>
              <CardTitle>Cost sheet</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {inputError && <p className="text-sm text-destructive">{inputError}</p>}
              {!input ? (
                <p className="text-sm text-muted-foreground">Choose units and a payment plan to see the price and schedule.</p>
              ) : preview.isError ? (
                <p className="text-sm text-destructive">{errorMessage(preview.error)}</p>
              ) : !preview.data ? (
                <p className="text-sm text-muted-foreground">Calculating…</p>
              ) : (
                <CostSheet q={preview.data} />
              )}
              <Button className="w-full" disabled={!ready} loading={save.isPending} onClick={() => save.mutate()}>
                Save quotation
              </Button>
              {!who && <p className="text-center text-xs text-muted-foreground">Choose who the quotation is for.</p>}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function CostSheet({ q }: { q: Pick<QuotePreview, 'items' | 'discountPaise' | 'chargesTotalPaise' | 'netAmountPaise' | 'planName' | 'schedule'> & { charges?: { name: string; amountPaise: number }[]; unavailable?: { plotNumber: string }[] } }) {
  return (
    <>
      {!!q.unavailable?.length && <p className="rounded-md bg-red-50 p-2 text-sm text-red-800 dark:bg-red-950/30 dark:text-red-200">No longer available: {q.unavailable.map((u) => u.plotNumber).join(', ')}</p>}
      <table className="w-full text-sm">
        <tbody>
          {q.items.map((i) => (
            <tr key={i.plotId}>
              <td className="py-1">
                Unit {i.blockCode ? `${i.blockCode}-` : ''}
                {i.plotNumber}
                <span className="block text-xs text-muted-foreground">
                  {areaToSqft(i.areaX100)} sq ft × {formatINR(i.ratePaisePerSqft, { decimals: false })}
                  {i.plcPaise ? ` + PLC ${formatINR(i.plcPaise, { decimals: false })}` : ''}
                </span>
              </td>
              <td className="py-1 text-right tabular">{formatINR(i.lineTotalPaise)}</td>
            </tr>
          ))}
          {q.discountPaise > 0 && (
            <tr>
              <td className="py-1">Discount</td>
              <td className="py-1 text-right tabular">−{formatINR(q.discountPaise)}</td>
            </tr>
          )}
          {q.charges
            ? q.charges.map((c) => (
                <tr key={c.name}>
                  <td className="py-1">{c.name}</td>
                  <td className="py-1 text-right tabular">{formatINR(c.amountPaise)}</td>
                </tr>
              ))
            : q.chargesTotalPaise > 0 && (
                <tr>
                  <td className="py-1">Charges</td>
                  <td className="py-1 text-right tabular">{formatINR(q.chargesTotalPaise)}</td>
                </tr>
              )}
          <tr className="border-t font-semibold">
            <td className="pt-2">Total</td>
            <td className="pt-2 text-right tabular">{formatINR(q.netAmountPaise)}</td>
          </tr>
        </tbody>
      </table>
      {q.schedule.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Schedule · {q.planName}</p>
          <ul className="max-h-56 space-y-1 overflow-y-auto text-sm">
            {q.schedule.map((s) => (
              <li key={s.sequence} className="flex justify-between gap-2">
                <span>
                  {s.name} <span className="text-muted-foreground">· {formatDate(s.dueDate)}</span>
                </span>
                <span className="tabular">{formatINR(s.amountPaise)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

// ---------------- Quotation detail ----------------

export function QuotationDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['quotation', id], queryFn: () => api.get<Quotation>(`/quotations/${id}`) });
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const status = useMutation({
    mutationFn: (s: string) => api.post(`/quotations/${id}/status`, { status: s }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quotation', id] });
      qc.invalidateQueries({ queryKey: ['quotations'] });
      setCancelOpen(false);
      toast.success('Quotation updated');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  /** Bookings need a customer: a lead is converted first (or linked to an existing customer by phone). */
  const convert = useMutation({
    mutationFn: async () => {
      const d = q.data!;
      let customerId = d.customerId?.id;
      if (!customerId && d.leadId) customerId = (await api.post<{ customerId: string }>(`/leads/${d.leadId.id}/convert`)).customerId;
      return customerId;
    },
    onSuccess: (customerId) => navigate(`/post-sales/bookings/new?quotation=${id}${customerId ? `&customer=${customerId}` : ''}`),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const p = prospect(d);
  const open = ['draft', 'sent', 'accepted'].includes(d.status);
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Quotations', to: '/pre-sales/quotations' }, { label: d.number }]}
        title={
          <span className="flex items-center gap-3">
            {d.number} <Badge variant={VARIANT[d.status]}>{titleCase(d.status)}</Badge>
          </span>
        }
        description={`${p?.name ?? ''} · ${d.projectId?.name ?? ''} · valid until ${formatDate(d.validUntil.slice(0, 10))}`}
        actions={
          <>
            <Button variant="outline" onClick={() => void download(`/quotations/${d.id}/pdf`, undefined, 'open')}>
              <FileDown /> Cost sheet PDF
            </Button>
            {d.leadId && <WhatsAppButton entityType="lead" entityId={d.leadId.id} categories={['quotation', 'lead_followup']} size="default" />}
            {d.customerId && !d.leadId && <WhatsAppButton entityType="customer" entityId={d.customerId.id} categories={['quotation']} size="default" />}
            {can('quotations.update') && d.status === 'draft' && (
              <Button variant="outline" loading={status.isPending} onClick={() => status.mutate('sent')}>
                <Send /> Mark sent
              </Button>
            )}
            {can('quotations.update') && ['draft', 'sent'].includes(d.status) && (
              <Button variant="outline" loading={status.isPending} onClick={() => status.mutate('accepted')}>
                <CheckCircle2 /> Accepted
              </Button>
            )}
            {open && can('bookings.create') && (d.customerId || d.leadId) && (
              <Button loading={convert.isPending} onClick={() => convert.mutate()}>
                Convert to booking <ArrowRight />
              </Button>
            )}
            {open && can('quotations.update') && (
              <Button variant="ghost" className="text-destructive" onClick={() => setCancelOpen(true)}>
                <Ban /> Cancel
              </Button>
            )}
          </>
        }
      />
      {d.status === 'converted' && d.bookingId && (
        <p className="mb-4 rounded-md border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-200">
          Converted into booking{' '}
          <Link to={`/post-sales/bookings/${d.bookingId.id}`} className="font-medium underline">
            {d.bookingId.bookingNumber}
          </Link>
          .
        </p>
      )}
      {d.status === 'expired' && <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">This quotation has expired. Make a new one with current prices.</p>}
      {open && !d.customerId && !d.leadId && <p className="mb-4 text-sm text-muted-foreground">Walk-in quotation: create the customer, then make the booking from Unit Bookings.</p>}
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader>
            <CardTitle>Cost sheet</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <CostSheet q={{ ...d, schedule: d.schedule ?? [] }} />
            {d.notes && <p className="rounded-md bg-muted/50 p-3 text-sm">{d.notes}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <DescriptionList
              className="sm:grid-cols-1"
              items={[
                {
                  label: d.leadId ? 'Lead' : d.customerId ? 'Customer' : 'Prospect',
                  value: d.leadId ? (
                    <Link to={`/pre-sales/leads?lead=${d.leadId.id}`} className="text-primary hover:underline">
                      {d.leadId.name}
                    </Link>
                  ) : d.customerId ? (
                    <Link to={`/post-sales/customers/${d.customerId.id}`} className="text-primary hover:underline">
                      {d.customerId.name}
                    </Link>
                  ) : (
                    d.prospectName
                  ),
                },
                { label: 'Phone', value: p?.phone || '—' },
                { label: 'Project', value: d.projectId?.name },
                { label: 'Units', value: units(d) },
                { label: 'Quotation date', value: formatDate(d.quoteDate.slice(0, 10)) },
                { label: 'Valid until', value: formatDate(d.validUntil.slice(0, 10)) },
                { label: 'Prepared by', value: d.createdBy?.name },
              ]}
            />
          </CardContent>
        </Card>
      </div>
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={`Cancel ${d.number}?`}
        description="The quotation stays on record but can no longer be converted."
        destructive
        confirmLabel="Cancel quotation"
        loading={status.isPending}
        onConfirm={() => status.mutate('cancelled')}
      />
    </>
  );
}
