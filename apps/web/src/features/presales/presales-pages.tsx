import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, FlaskConical, History, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { LEAD_STATUSES, PORTALS, WHATSAPP_TEMPLATE_CATEGORIES, WHATSAPP_VARIABLES } from '@erp/shared';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { formatDateTime, titleCase } from '@/lib/format';
import { useAuth } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Checkbox, Input, Label, Textarea } from '@/components/ui/primitives';
import { ConfirmDialog, Dialog, DialogContent, DialogFooter } from '@/components/ui/overlays';
import { Field, PageHeader } from '@/components/common';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/states';
import { FormFields, MasterCrud, type FieldDef } from '@/components/master-crud';

// =====================================================================
// Lead stages & sources
// =====================================================================

export interface LeadSettings {
  sources: { key: string; label: string; active: boolean }[];
  stageLabels: Record<string, string>;
  lostReasons: string[];
}

export function useLeadSettings() {
  return useQuery({ queryKey: ['lead-settings'], queryFn: () => api.get<LeadSettings>('/lead-settings'), staleTime: 5 * 60_000 });
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);

export function LeadSettingsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useLeadSettings();
  const [form, setForm] = React.useState<LeadSettings | null>(null);
  const [newSource, setNewSource] = React.useState('');
  const [newReason, setNewReason] = React.useState('');
  React.useEffect(() => {
    if (q.data) setForm(structuredClone(q.data));
  }, [q.data]);
  const save = useMutation({
    mutationFn: (f: LeadSettings) => api.put<LeadSettings>('/lead-settings', f),
    onSuccess: (d) => {
      qc.setQueryData(['lead-settings'], d);
      toast.success('Lead settings saved');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isPending || !form) return <PageSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const editable = can('crm.configure');
  const addSource = () => {
    const label = newSource.trim();
    const key = slug(label);
    if (!key) return;
    if (form.sources.some((s) => s.key === key)) return toast.error('That source already exists');
    setForm({ ...form, sources: [...form.sources, { key, label, active: true }] });
    setNewSource('');
  };
  const addReason = () => {
    const r = newReason.trim();
    if (!r || form.lostReasons.includes(r)) return;
    setForm({ ...form, lostReasons: [...form.lostReasons, r] });
    setNewReason('');
  };
  return (
    <>
      <PageHeader
        title="Lead Stages & Sources"
        description="Where your enquiries come from, what each pipeline stage is called, and why leads are lost"
        actions={
          editable && (
            <Button loading={save.isPending} onClick={() => save.mutate(form)}>
              <Save /> Save changes
            </Button>
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="lg:row-span-2">
          <CardHeader>
            <CardTitle>Lead sources</CardTitle>
            <CardDescription>Inactive sources stay on existing leads but can’t be chosen for new ones.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-md border">
              {form.sources.map((s, i) => (
                <li key={s.key} className="flex items-center gap-3 px-3 py-2">
                  <Checkbox
                    id={`src-${s.key}`}
                    checked={s.active}
                    disabled={!editable || s.key === 'other'}
                    onCheckedChange={(c) => setForm({ ...form, sources: form.sources.map((x, j) => (j === i ? { ...x, active: c === true } : x)) })}
                    aria-label={`${s.label} active`}
                  />
                  <Input
                    value={s.label}
                    disabled={!editable}
                    onChange={(e) => setForm({ ...form, sources: form.sources.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
                    className="h-8"
                    aria-label={`Label for ${s.key}`}
                  />
                  <code className="hidden shrink-0 text-xs text-muted-foreground sm:block">{s.key}</code>
                </li>
              ))}
            </ul>
            {editable && (
              <div className="mt-3 flex gap-2">
                <Input value={newSource} onChange={(e) => setNewSource(e.target.value)} placeholder="New source, e.g. Radio FM" onKeyDown={(e) => e.key === 'Enter' && addSource()} />
                <Button variant="outline" onClick={addSource}>
                  <Plus /> Add
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Pipeline stages</CardTitle>
            <CardDescription>Rename the stages shown on the leads board. The order and meaning stay the same.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {LEAD_STATUSES.map((s, i) => (
              <Field key={s} label={`${i + 1}. ${titleCase(s)}`} htmlFor={`stage-${s}`}>
                <Input disabled={!editable} value={form.stageLabels[s] ?? ''} onChange={(e) => setForm({ ...form, stageLabels: { ...form.stageLabels, [s]: e.target.value } })} />
              </Field>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Lost reasons</CardTitle>
            <CardDescription>Offered when a lead is marked lost; free text is still allowed.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {form.lostReasons.map((r) => (
                <Badge key={r} variant="secondary" className="gap-1 py-1 pl-2.5">
                  {r}
                  {editable && (
                    <button type="button" onClick={() => setForm({ ...form, lostReasons: form.lostReasons.filter((x) => x !== r) })} aria-label={`Remove ${r}`} className="cursor-pointer">
                      <X className="size-3" />
                    </button>
                  )}
                </Badge>
              ))}
              {!form.lostReasons.length && <p className="text-sm text-muted-foreground">None</p>}
            </div>
            {editable && (
              <div className="mt-3 flex gap-2">
                <Input value={newReason} onChange={(e) => setNewReason(e.target.value)} placeholder="Add a reason" onKeyDown={(e) => e.key === 'Enter' && addReason()} />
                <Button variant="outline" onClick={addReason}>
                  <Plus /> Add
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

// =====================================================================
// WhatsApp templates
// =====================================================================

interface Template {
  id: string;
  name: string;
  category: string;
  body: string;
  isActive: boolean;
  timesUsed: number;
}

const SAMPLE: Record<string, string> = {
  name: 'Rohit Sharma',
  phone: '+91 98765 43210',
  project: 'Green Valley Enclave',
  company: 'Sunrise Colonizers',
  executive: 'Anita',
  booking_no: 'BKG/2026-27/00012',
  units: 'B-14',
  amount_due: '₹2,50,000.00',
  due_date: '15 Nov 2026',
  total_amount: '₹26,40,000.00',
};

function TemplateBody({ value, set }: { value: string; set: (v: string) => void }) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const insert = (v: string) => {
    const el = ref.current;
    const token = `{{${v}}}`;
    if (!el) return set(`${value}${token}`);
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    set(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };
  const preview = value.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k: string) => SAMPLE[k] ?? m);
  return (
    <div className="space-y-2">
      <Textarea ref={ref} rows={6} value={value} onChange={(e) => set(e.target.value)} placeholder="Namaste {{name}}, thank you for your interest in {{project}}…" />
      <div className="flex flex-wrap gap-1">
        {WHATSAPP_VARIABLES.map((v) => (
          <button key={v} type="button" onClick={() => insert(v)} className="cursor-pointer rounded border bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] hover:bg-muted">
            {`{{${v}}}`}
          </button>
        ))}
      </div>
      {value && (
        <div className="rounded-lg bg-[#e7fbd8] p-3 text-sm text-neutral-900 shadow-sm dark:bg-[#1f3b2a] dark:text-neutral-100">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide opacity-60">Preview (sample data)</p>
          <p className="whitespace-pre-wrap">{preview}</p>
        </div>
      )}
    </div>
  );
}

export function WhatsappTemplatesPage() {
  const fields: FieldDef[] = [
    { name: 'name', label: 'Template name', type: 'text', required: true, placeholder: 'Site visit reminder' },
    { name: 'category', label: 'Used for', type: 'select', required: true, options: WHATSAPP_TEMPLATE_CATEGORIES },
    { name: 'body', label: 'Message', type: 'custom', required: true, span: 2, render: (v, set) => <TemplateBody value={String(v ?? '')} set={set} /> },
    { name: 'isActive', label: 'Active', type: 'checkbox' },
  ];
  return (
    <MasterCrud<Template>
      title="WhatsApp Templates"
      description="Ready messages for follow-ups, reminders and demand letters. Send them from any lead, booking or dues row."
      endpoint="/whatsapp-templates"
      queryKey="whatsapp-templates"
      entityLabel="template"
      sort="category"
      defaults={{ category: 'lead_followup', isActive: true, body: '' }}
      filters={[{ key: 'kind', label: 'Used for', options: WHATSAPP_TEMPLATE_CATEGORIES }]}
      permissions={{ create: 'crm.configure', update: 'crm.configure', delete: 'crm.configure' }}
      fields={fields}
      columns={[
        { key: 'name', header: 'Template', sortKey: 'name', cell: (t) => <span className="font-medium">{t.name}</span> },
        { key: 'category', header: 'Used for', sortKey: 'category', cell: (t) => titleCase(t.category) },
        { key: 'body', header: 'Message', cell: (t) => <span className="line-clamp-2 max-w-md text-muted-foreground">{t.body}</span> },
        { key: 'used', header: 'Sent', sortKey: 'timesUsed', align: 'right', cell: (t) => t.timesUsed },
        { key: 'active', header: 'Status', cell: (t) => (t.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="muted">Inactive</Badge>) },
      ]}
      empty={<EmptyState title="No templates yet" description="Create messages once and send them in two clicks from leads, bookings and the dues list." />}
    />
  );
}

// =====================================================================
// Portal integrations
// =====================================================================

interface Integration {
  id: string;
  portal: string;
  name: string;
  token: string;
  isActive: boolean;
  leadsReceived: number;
  duplicates: number;
  lastReceivedAt?: string;
  projectId?: { id: string; name: string };
  defaultAssigneeId?: { id: string; name: string };
}
interface InboundLog {
  id: string;
  outcome: 'created' | 'duplicate' | 'rejected';
  name?: string;
  phone?: string;
  error?: string;
  payload?: string;
  createdAt: string;
}
interface Member {
  id: string;
  name: string;
}

const PORTAL_LABEL: Record<string, string> = {
  '99acres': '99acres',
  magicbricks: 'MagicBricks',
  housing: 'Housing.com',
  facebook: 'Facebook / Instagram lead ads',
  google: 'Google Ads lead forms',
  website: 'Website enquiry form',
  other: 'Other',
};

function webhookUrl(token: string) {
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api/v1';
  return new URL(`${base.replace(/\/$/, '')}/inbound/leads/${token}`, window.location.origin).toString();
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = React.useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? <Check /> : <Copy />} {done ? 'Copied' : label}
    </Button>
  );
}

function formSnippet(url: string) {
  return `<form action="${url}" method="POST">
  <input name="name" placeholder="Your name" required>
  <input name="phone" type="tel" placeholder="Mobile number" required>
  <input name="email" type="email" placeholder="Email">
  <textarea name="message" placeholder="What are you looking for?"></textarea>
  <button type="submit">Send enquiry</button>
</form>`;
}

export function IntegrationsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['integrations'], queryFn: () => api.page<Integration>('/integrations', { pageSize: 100 }) });
  const [editing, setEditing] = React.useState<Integration | 'new' | null>(null);
  const [logs, setLogs] = React.useState<Integration | null>(null);
  const [testing, setTesting] = React.useState<Integration | null>(null);
  const [confirm, setConfirm] = React.useState<{ row: Integration; kind: 'rotate' | 'delete' } | null>(null);
  const act = useMutation({
    mutationFn: (c: NonNullable<typeof confirm>) => (c.kind === 'rotate' ? api.post(`/integrations/${c.row.id}/rotate`) : api.delete(`/integrations/${c.row.id}`)),
    onSuccess: (_d, c) => {
      qc.invalidateQueries({ queryKey: ['integrations'] });
      setConfirm(null);
      toast.success(c.kind === 'rotate' ? 'New URL generated. Update it on the portal.' : 'Integration removed');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <>
      <PageHeader
        title="Portal Integrations (99acres, MagicBricks)"
        description="Every channel gets its own secret webhook URL. Enquiries arrive as leads instantly; repeat enquiries are merged."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus /> New integration
          </Button>
        }
      />
      {!q.data.items.length && (
        <EmptyState
          title="No integrations yet"
          description="Connect 99acres, MagicBricks, Housing.com, Facebook lead ads or your website form. Paste the URL in the portal’s lead push / webhook settings."
          action={
            <Button onClick={() => setEditing('new')}>
              <Plus /> New integration
            </Button>
          }
        />
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        {q.data.items.map((i) => {
          const url = webhookUrl(i.token);
          return (
            <Card key={i.id} className={i.isActive ? '' : 'opacity-70'}>
              <CardHeader className="flex-row items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">{i.name}</CardTitle>
                  <CardDescription>
                    {PORTAL_LABEL[i.portal] ?? i.portal}
                    {i.projectId && ` · ${i.projectId.name}`}
                    {i.defaultAssigneeId && ` · assigns to ${i.defaultAssigneeId.name}`}
                  </CardDescription>
                </div>
                {i.isActive ? <Badge variant="success">Live</Badge> : <Badge variant="muted">Paused</Badge>}
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5 text-xs">{url}</code>
                  <CopyButton text={url} />
                </div>
                <p className="text-sm text-muted-foreground">
                  {i.leadsReceived} leads · {i.duplicates} repeat enquiries{i.lastReceivedAt && ` · last ${formatDateTime(i.lastReceivedAt)}`}
                </p>
                {i.portal === 'website' && (
                  <details className="rounded-md border p-2 text-sm">
                    <summary className="cursor-pointer font-medium">Website form code</summary>
                    <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-xs">{formSnippet(url)}</pre>
                    <div className="mt-2">
                      <CopyButton text={formSnippet(url)} label="Copy code" />
                    </div>
                  </details>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setTesting(i)}>
                    <FlaskConical /> Send test lead
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setLogs(i)}>
                    <History /> Recent deliveries
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditing(i)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirm({ row: i, kind: 'rotate' })}>
                    <RefreshCw /> New URL
                  </Button>
                  <Button size="icon-sm" variant="ghost" onClick={() => setConfirm({ row: i, kind: 'delete' })} aria-label={`Delete ${i.name}`}>
                    <Trash2 />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">How to connect</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            <strong className="text-foreground">99acres / MagicBricks / Housing.com:</strong> ask your account manager to enable lead push (API / webhook) and give them the URL. Fields such as name, mobile,
            email and message are recognised automatically.
          </p>
          <p>
            <strong className="text-foreground">Facebook & Google lead forms:</strong> connect through Zapier, Pabbly or Make and send the lead to the URL as JSON.
          </p>
          <p>
            <strong className="text-foreground">Website:</strong> paste the form code, or post JSON <code>{'{ "name", "phone", "email", "message" }'}</code> from your site.
          </p>
        </CardContent>
      </Card>
      <IntegrationDialog editing={editing} onClose={() => setEditing(null)} />
      <LogsDialog integration={logs} onClose={() => setLogs(null)} />
      <TestDialog integration={testing} onClose={() => setTesting(null)} />
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.kind === 'rotate' ? `Generate a new URL for ${confirm.row.name}?` : `Remove ${confirm?.row.name}?`}
        description={confirm?.kind === 'rotate' ? 'The old URL stops working immediately. Update the portal with the new one.' : 'Leads already received are kept. The URL stops working.'}
        destructive={confirm?.kind === 'delete'}
        confirmLabel={confirm?.kind === 'rotate' ? 'Generate new URL' : 'Remove'}
        loading={act.isPending}
        onConfirm={() => confirm && act.mutate(confirm)}
      />
    </>
  );
}

function IntegrationDialog({ editing, onClose }: { editing: Integration | 'new' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const row = editing && editing !== 'new' ? editing : undefined;
  const members = useQuery({ queryKey: ['members'], queryFn: () => api.get<Member[]>('/members'), enabled: !!editing });
  const [values, setValues] = React.useState<Record<string, unknown>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    if (!editing) return;
    setValues({ portal: row?.portal ?? '99acres', name: row?.name ?? '', projectId: row?.projectId?.id ?? '', defaultAssigneeId: row?.defaultAssigneeId?.id ?? '', isActive: row?.isActive ?? true });
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  const fields: FieldDef[] = [
    { name: 'portal', label: 'Channel', type: 'select', required: true, options: PORTALS.map((p) => ({ value: p, label: PORTAL_LABEL[p] ?? p })) },
    { name: 'name', label: 'Name', type: 'text', required: true, placeholder: '99acres – Green Valley' },
    { name: 'projectId', label: 'Project for these leads', type: 'project', allowAll: 'Not project-specific' },
    { name: 'defaultAssigneeId', label: 'Assign new leads to', type: 'select', options: (members.data ?? []).map((m) => ({ value: m.id, label: m.name })), emptyLabel: 'Unassigned' },
    { name: 'isActive', label: 'Live (accept leads)', type: 'checkbox' },
  ];
  const save = useMutation({
    mutationFn: () => {
      const body = { portal: values.portal, name: String(values.name ?? '').trim(), projectId: values.projectId || undefined, defaultAssigneeId: values.defaultAssigneeId || undefined, isActive: values.isActive === true };
      return row ? api.patch(`/integrations/${row.id}`, body) : api.post('/integrations', body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations'] });
      toast.success('Integration saved');
      onClose();
    },
    onError: (e) => {
      setErrors(fieldErrors(e));
      toast.error(errorMessage(e));
    },
  });
  return (
    <Dialog open={!!editing} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={row ? `Edit ${row.name}` : 'New integration'}>
        <FormFields fields={fields} values={values} onChange={setValues} errors={errors} idPrefix="integ" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LogsDialog({ integration, onClose }: { integration: Integration | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ['integrations', integration?.id, 'logs'], queryFn: () => api.get<InboundLog[]>(`/integrations/${integration!.id}/logs`), enabled: !!integration });
  const variant = { created: 'success', duplicate: 'info', rejected: 'destructive' } as const;
  return (
    <Dialog open={!!integration} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Recent deliveries · ${integration?.name ?? ''}`} className="max-w-2xl">
        {q.isPending ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !q.data?.length ? (
          <p className="text-sm text-muted-foreground">Nothing received yet.</p>
        ) : (
          <ul className="max-h-[60vh] divide-y overflow-y-auto rounded-md border text-sm">
            {q.data.map((l) => (
              <li key={l.id} className="px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {l.name ?? '—'} <span className="font-normal text-muted-foreground">{l.phone}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge variant={variant[l.outcome]}>{titleCase(l.outcome)}</Badge>
                    <span className="text-xs text-muted-foreground">{formatDateTime(l.createdAt)}</span>
                  </span>
                </div>
                {l.error && <p className="text-xs text-destructive">{l.error}</p>}
                {l.payload && (
                  <details>
                    <summary className="cursor-pointer text-xs text-muted-foreground">Payload</summary>
                    <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-[11px]">{l.payload}</pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TestDialog({ integration, onClose }: { integration: Integration | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = React.useState('Test Enquiry');
  const [phone, setPhone] = React.useState('9000000001');
  const [message, setMessage] = React.useState('Looking for a 1200 sq ft plot');
  const send = useMutation({
    mutationFn: () => api.post<{ status: number; duplicate?: boolean; error?: string }>(`/integrations/${integration!.id}/test`, { name, phone, message }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['integrations'] });
      qc.invalidateQueries({ queryKey: ['leads'] });
      if (r.status === 422) toast.error(r.error ?? 'Rejected');
      else toast.success(r.duplicate ? 'Received – merged into the existing open lead' : 'Received – a new lead was created');
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={!!integration} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Send a test lead" description="Runs through exactly the same steps as a real portal enquiry.">
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="t-name">Name</Label>
            <Input id="t-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="t-phone">Phone</Label>
            <Input id="t-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="t-msg">Message</Label>
            <Textarea id="t-msg" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={send.isPending} onClick={() => send.mutate()}>
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
