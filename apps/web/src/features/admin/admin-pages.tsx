import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail, Monitor, Plus, Save, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { changePasswordSchema, OVERPAYMENT_POLICIES, PERMISSION_GROUPS, PERMISSION_LABELS } from '@erp/shared';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, titleCase } from '@/lib/format';
import { useListParams } from '@/hooks/use-list-params';
import { useProjectContext } from '@/hooks/use-project';
import { Can, useAuth } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Checkbox, Input, Label, Select } from '@/components/ui/primitives';
import { ConfirmDialog, Dialog, DialogContent, DialogFooter } from '@/components/ui/overlays';
import { DataTable, type Column } from '@/components/data-table';
import { Field, PageHeader, StatusBadge } from '@/components/common';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/states';
import { SearchInput } from '@/components/search-input';

interface Role {
  id: string;
  name: string;
  description?: string;
  systemKey?: string;
  isSystem: boolean;
  permissions: string[];
  memberCount: number;
}
interface Member {
  id: string;
  status: string;
  projectAccess: { mode: 'all' | 'restricted'; projectIds: string[] };
  userId: { id: string; name: string; email: string; lastLoginAt?: string };
  roleId: { id: string; name: string } | null;
}

function useRoles() {
  return useQuery({ queryKey: ['roles'], queryFn: () => api.get<Role[]>('/roles') });
}

function ProjectAccessPicker({
  value,
  onChange,
}: {
  value: { mode: 'all' | 'restricted'; projectIds: string[] };
  onChange: (v: { mode: 'all' | 'restricted'; projectIds: string[] }) => void;
}) {
  const { projects } = useProjectContext();
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Project access</legend>
      <label className="flex items-center gap-2 text-sm">
        <input type="radio" checked={value.mode === 'all'} onChange={() => onChange({ mode: 'all', projectIds: [] })} /> All projects
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="radio"
          checked={value.mode === 'restricted'}
          onChange={() => onChange({ mode: 'restricted', projectIds: value.projectIds })}
        />{' '}
        Only selected projects
      </label>
      {value.mode === 'restricted' && (
        <div className="ml-6 max-h-40 space-y-1.5 overflow-y-auto rounded-md border p-2">
          {projects.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={value.projectIds.includes(p.id)}
                onCheckedChange={(c) =>
                  onChange({ mode: 'restricted', projectIds: c ? [...value.projectIds, p.id] : value.projectIds.filter((x) => x !== p.id) })
                }
              />
              {p.name}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

export function UsersPage() {
  const lp = useListParams();
  const qc = useQueryClient();
  const { context } = useAuth();
  const roles = useRoles();
  const [inviting, setInviting] = React.useState(false);
  const [editing, setEditing] = React.useState<Member | null>(null);
  const [inviteEmail, setInviteEmail] = React.useState('');
  const [inviteRole, setInviteRole] = React.useState('');
  const [access, setAccess] = React.useState<{ mode: 'all' | 'restricted'; projectIds: string[] }>({ mode: 'all', projectIds: [] });
  const members = useQuery({ queryKey: ['members', lp.query], queryFn: () => api.page<Member>('/users', lp.query) });
  const invitations = useQuery({
    queryKey: ['invitations'],
    queryFn: () => api.get<{ id: string; email: string; expiresAt: string; roleId?: { name: string } }[]>('/invitations'),
  });

  const invite = useMutation({
    mutationFn: () => api.post('/invitations', { email: inviteEmail, roleId: inviteRole, projectAccess: access }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invitations'] });
      setInviting(false);
      setInviteEmail('');
      toast.success('Invitation sent');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/invitations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invitations'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const update = useMutation({
    mutationFn: (v: { id: string; roleId?: string; status?: string; projectAccess?: typeof access }) =>
      api.patch(`/users/${v.id}`, { roleId: v.roleId, status: v.status, projectAccess: v.projectAccess }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['members'] });
      setEditing(null);
      toast.success('User updated');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const columns: Column<Member>[] = [
    {
      key: 'user',
      header: 'User',
      cell: (m) => (
        <div>
          <p className="font-medium">
            {m.userId.name} {m.userId.id === context?.user.id && <span className="text-xs text-muted-foreground">(you)</span>}
          </p>
          <p className="text-xs text-muted-foreground">{m.userId.email}</p>
        </div>
      ),
    },
    { key: 'role', header: 'Role', cell: (m) => m.roleId?.name ?? '—' },
    {
      key: 'access',
      header: 'Projects',
      cell: (m) => (m.projectAccess.mode === 'all' ? 'All' : `${m.projectAccess.projectIds.length} selected`),
      hideOnMobile: true,
    },
    {
      key: 'login',
      header: 'Last sign-in',
      cell: (m) => (m.userId.lastLoginAt ? formatDateTime(m.userId.lastLoginAt) : 'Never'),
      hideOnMobile: true,
    },
    { key: 'status', header: 'Status', cell: (m) => <StatusBadge status={m.status} /> },
  ];

  const [editRole, setEditRole] = React.useState('');
  const [editAccess, setEditAccess] = React.useState(access);
  React.useEffect(() => {
    if (editing) {
      setEditRole(editing.roleId?.id ?? '');
      setEditAccess({ mode: editing.projectAccess.mode, projectIds: editing.projectAccess.projectIds });
    }
  }, [editing]);

  return (
    <>
      <PageHeader
        title="Users"
        description="Team members of this company and what they can access"
        actions={
          <Can permission="users.create">
            <Button
              onClick={() => {
                setInviteRole(roles.data?.find((r) => r.systemKey === 'sales')?.id ?? '');
                setInviting(true);
              }}
            >
              <UserPlus /> Invite user
            </Button>
          </Can>
        }
      />
      <div className="mb-4">
        <SearchInput value={lp.q} onChange={lp.setQ} placeholder="Name or email" />
      </div>
      <DataTable
        columns={columns}
        rows={members.data?.items}
        rowKey={(m) => m.id}
        loading={members.isPending}
        error={members.error}
        onRetry={() => members.refetch()}
        meta={members.data?.meta}
        onPageChange={lp.setPage}
        onRowClick={(m) => (m.userId.id === context?.user.id ? toast.info('You cannot change your own role or status') : setEditing(m))}
      />
      {(invitations.data?.length ?? 0) > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Pending invitations</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {invitations.data!.map((i) => (
                <li key={i.id} className="flex items-center justify-between py-2">
                  <span className="flex items-center gap-2">
                    <Mail className="size-4 text-muted-foreground" /> {i.email} · {i.roleId?.name} · expires {formatDateTime(i.expiresAt)}
                  </span>
                  <Can permission="users.create">
                    <Button variant="ghost" size="sm" onClick={() => revoke.mutate(i.id)}>
                      Revoke
                    </Button>
                  </Can>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Dialog open={inviting} onOpenChange={setInviting}>
        <DialogContent title="Invite a user" description="They receive an email link valid for 7 days.">
          <div className="grid gap-4">
            <Field label="Email" htmlFor="inv-email" required>
              <Input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
            </Field>
            <Field label="Role" htmlFor="inv-role" required>
              <Select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                <option value="">Choose…</option>
                {roles.data?.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </Field>
            <ProjectAccessPicker value={access} onChange={setAccess} />
          </div>
          <DialogFooter>
            <Button disabled={!inviteEmail || !inviteRole} loading={invite.isPending} onClick={() => invite.mutate()}>
              Send invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <DialogContent title={editing.userId.name} description={editing.userId.email}>
            <div className="grid gap-4">
              <Field label="Role" htmlFor="ed-role">
                <Select value={editRole} onChange={(e) => setEditRole(e.target.value)}>
                  {roles.data?.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <ProjectAccessPicker value={editAccess} onChange={setEditAccess} />
            </div>
            <DialogFooter>
              <Can permission="users.deactivate">
                <Button
                  variant="outline"
                  className={editing.status === 'active' ? 'text-destructive' : ''}
                  onClick={() => update.mutate({ id: editing.id, status: editing.status === 'active' ? 'disabled' : 'active' })}
                >
                  {editing.status === 'active' ? 'Disable access' : 'Re-enable access'}
                </Button>
              </Can>
              <Button
                loading={update.isPending}
                onClick={() => update.mutate({ id: editing.id, roleId: editRole, projectAccess: editAccess })}
              >
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

export function RolesPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const roles = useRoles();
  const [selected, setSelected] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<Set<string>>(new Set());
  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [deleting, setDeleting] = React.useState(false);
  const role = roles.data?.find((r) => r.id === selected) ?? roles.data?.[0];
  React.useEffect(() => {
    if (role) setDraft(new Set(role.permissions));
  }, [role]);

  const save = useMutation({
    mutationFn: () => api.patch(`/roles/${role!.id}`, { permissions: [...draft] }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roles'] });
      toast.success('Permissions saved. They apply on the user’s next request.');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const create = useMutation({
    mutationFn: () => api.post<Role>('/roles', { name: newName, permissions: ['dashboard.read'] }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['roles'] });
      setCreating(false);
      setNewName('');
      setSelected(r.id);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/roles/${role!.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roles'] });
      setDeleting(false);
      setSelected(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (roles.isPending) return <PageSkeleton />;
  if (roles.isError) return <ErrorState error={roles.error} onRetry={() => roles.refetch()} />;
  const editable = can('roles.update') && role?.systemKey !== 'owner';
  const dirty = role && (draft.size !== role.permissions.length || role.permissions.some((p) => !draft.has(p)));

  return (
    <>
      <PageHeader
        title="Roles & Permissions"
        description="The server enforces these on every request"
        actions={
          <Can permission="roles.create">
            <Button variant="outline" onClick={() => setCreating(true)}>
              <Plus /> New role
            </Button>
          </Can>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card className="p-2">
          <ul>
            {roles.data.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setSelected(r.id)}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-muted cursor-pointer ${role?.id === r.id ? 'bg-accent font-medium' : ''}`}
                >
                  <span>{r.name}</span>
                  <span className="text-xs text-muted-foreground">{r.memberCount}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
        {role && (
          <Card>
            <CardHeader className="flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="size-5 text-primary" /> {role.name}
                </CardTitle>
                <CardDescription>{role.description ?? (role.isSystem ? 'System role' : 'Custom role')}</CardDescription>
              </div>
              <div className="flex gap-2">
                {!role.isSystem && can('roles.delete') && (
                  <Button variant="ghost" size="icon" onClick={() => setDeleting(true)} aria-label="Delete role">
                    <Trash2 />
                  </Button>
                )}
                {editable && (
                  <Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
                    <Save /> Save
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {role.systemKey === 'owner' && (
                <p className="mb-4 text-sm text-muted-foreground">The owner role always has every permission.</p>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {Object.entries(PERMISSION_GROUPS).map(([group, actions]) => (
                      <tr key={group} className="border-b last:border-0">
                        <th scope="row" className="w-48 py-2.5 pr-4 text-left font-medium">
                          {PERMISSION_LABELS[group]}
                        </th>
                        <td className="py-2.5">
                          <div className="flex flex-wrap gap-x-5 gap-y-2">
                            {(actions as readonly string[]).map((a) => {
                              const key = `${group}.${a}`;
                              return (
                                <label key={key} className="flex items-center gap-1.5">
                                  <Checkbox
                                    disabled={!editable}
                                    checked={draft.has(key)}
                                    onCheckedChange={(c) =>
                                      setDraft((d) => {
                                        const n = new Set(d);
                                        if (c) n.add(key);
                                        else n.delete(key);
                                        return n;
                                      })
                                    }
                                    aria-label={`${PERMISSION_LABELS[group]}: ${a}`}
                                  />
                                  {titleCase(a.replace(/([A-Z])/g, ' $1'))}
                                </label>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent title="New role">
          <Field label="Role name" htmlFor="role-name" required>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Site Engineer" />
          </Field>
          <DialogFooter>
            <Button disabled={!newName.trim()} loading={create.isPending} onClick={() => create.mutate()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete role ${role?.name}?`}
        description="Roles with members cannot be deleted."
        destructive
        confirmLabel="Delete"
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  summary?: string;
  changes?: unknown;
  createdAt: string;
  ip?: string;
  actorId?: { name: string; email: string };
}

export function AuditPage() {
  const lp = useListParams({ pageSize: 50 });
  const [open, setOpen] = React.useState<AuditRow | null>(null);
  const filters = { entityType: lp.filter('entityType'), action: lp.filter('action'), from: lp.filter('from'), to: lp.filter('to') };
  const q = useQuery({
    queryKey: ['audit', lp.query, filters],
    queryFn: () => api.page<AuditRow>('/audit-logs', { page: lp.page, pageSize: lp.pageSize, ...filters }),
    placeholderData: (p) => p,
  });
  const columns: Column<AuditRow>[] = [
    { key: 'when', header: 'When', cell: (a) => <span className="whitespace-nowrap">{formatDateTime(a.createdAt)}</span> },
    { key: 'who', header: 'User', cell: (a) => a.actorId?.name ?? 'System' },
    { key: 'action', header: 'Action', cell: (a) => <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{a.action}</code> },
    { key: 'entity', header: 'Record', cell: (a) => titleCase(a.entityType), hideOnMobile: true },
    { key: 'summary', header: 'Summary', cell: (a) => <span className="line-clamp-1">{a.summary ?? ''}</span>, hideOnMobile: true },
  ];
  return (
    <>
      <PageHeader title="Activity Log" description="Immutable history of sensitive operations" />
      <div className="mb-4 flex flex-col gap-2 lg:flex-row">
        <Select
          className="lg:w-48"
          value={filters.entityType ?? ''}
          onChange={(e) => lp.setFilter('entityType', e.target.value || undefined)}
          aria-label="Record type"
        >
          <option value="">All records</option>
          {[
            'booking',
            'payment',
            'plot',
            'project',
            'customer',
            'journal_entry',
            'role',
            'membership',
            'invitation',
            'company',
            'session',
            'user',
          ].map((t) => (
            <option key={t} value={t}>
              {titleCase(t)}
            </option>
          ))}
        </Select>
        <Input
          className="lg:w-48"
          placeholder="Action starts with…"
          value={filters.action ?? ''}
          onChange={(e) => lp.setFilter('action', e.target.value || undefined)}
          aria-label="Action"
        />
        <Input
          type="date"
          className="lg:w-40"
          value={filters.from ?? ''}
          onChange={(e) => lp.setFilter('from', e.target.value || undefined)}
          aria-label="From"
        />
        <Input
          type="date"
          className="lg:w-40"
          value={filters.to ?? ''}
          onChange={(e) => lp.setFilter('to', e.target.value || undefined)}
          aria-label="To"
        />
      </div>
      <DataTable
        columns={columns}
        rows={q.data?.items}
        rowKey={(a) => a.id}
        loading={q.isPending}
        error={q.error}
        onRetry={() => q.refetch()}
        meta={q.data?.meta}
        onPageChange={lp.setPage}
        pageSize={lp.pageSize}
        onPageSizeChange={lp.setPageSize}
        onRowClick={setOpen}
        empty={<EmptyState title="No events" />}
      />
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        {open && (
          <DialogContent
            title={open.action}
            description={`${open.actorId?.name ?? 'System'} · ${formatDateTime(open.createdAt)}${open.ip ? ` · ${open.ip}` : ''}`}
            className="max-w-2xl"
          >
            {open.summary && <p className="text-sm">{open.summary}</p>}
            <pre className="max-h-96 overflow-auto rounded-lg bg-muted p-3 text-xs">{JSON.stringify(open.changes ?? {}, null, 2)}</pre>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

interface Company {
  id: string;
  name: string;
  legalName?: string;
  gstin?: string;
  pan?: string;
  phone?: string;
  email?: string;
  address?: { line1?: string; city?: string; state?: string; pincode?: string };
  settings: {
    overpaymentPolicy: string;
    reservationHoldHours: number;
    receiptPrefix: string;
    bookingPrefix: string;
    quotationValidityDays?: number;
    demandLeadDays?: number;
    registryRequiresFullPayment?: boolean;
    possessionRequiresFullPayment?: boolean;
    lateInterestBpPerMonth?: number;
  };
}

export function CompanySettingsPage({ section = 'profile' }: { section?: 'profile' | 'settings' }) {
  const qc = useQueryClient();
  const { can, reload } = useAuth();
  const q = useQuery({ queryKey: ['company'], queryFn: () => api.get<Company>('/company') });
  const [form, setForm] = React.useState<Company | null>(null);
  React.useEffect(() => {
    if (q.data) setForm(q.data);
  }, [q.data]);
  const save = useMutation({
    mutationFn: (c: Company) =>
      api.patch('/company', {
        name: c.name,
        legalName: c.legalName || undefined,
        gstin: c.gstin || undefined,
        pan: c.pan || undefined,
        phone: c.phone || undefined,
        email: c.email || undefined,
        address: c.address,
        settings: {
          ...c.settings,
          reservationHoldHours: Number(c.settings.reservationHoldHours),
          quotationValidityDays: Number(c.settings.quotationValidityDays ?? 15),
          demandLeadDays: Number(c.settings.demandLeadDays ?? 15),
          lateInterestBpPerMonth: Number(c.settings.lateInterestBpPerMonth ?? 0),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company'] });
      void reload();
      toast.success('Company settings saved');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isPending || !form) return <PageSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const disabled = !can('company.update');
  const set = (patch: Partial<Company>) => setForm((f) => ({ ...f!, ...patch }));
  const setS = (patch: Partial<Company['settings']>) => setForm((f) => ({ ...f!, settings: { ...f!.settings, ...patch } }));
  const setA = (patch: Partial<NonNullable<Company['address']>>) => setForm((f) => ({ ...f!, address: { ...f!.address, ...patch } }));
  return (
    <>
      <PageHeader
        title={section === 'profile' ? 'Company Profile' : 'Settings'}
        description={
          section === 'profile'
            ? 'Appears on receipts, letters, quotations and agreements'
            : 'Numbering, sales rules and post-sales controls'
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {section === 'profile' && (
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Display name" htmlFor="co-name" className="sm:col-span-2">
                <Input disabled={disabled} value={form.name} onChange={(e) => set({ name: e.target.value })} />
              </Field>
              <Field label="Legal name" htmlFor="co-legal" className="sm:col-span-2">
                <Input disabled={disabled} value={form.legalName ?? ''} onChange={(e) => set({ legalName: e.target.value })} />
              </Field>
              <Field label="GSTIN" htmlFor="co-gst">
                <Input
                  disabled={disabled}
                  className="uppercase"
                  value={form.gstin ?? ''}
                  onChange={(e) => set({ gstin: e.target.value })}
                />
              </Field>
              <Field label="PAN" htmlFor="co-pan">
                <Input disabled={disabled} className="uppercase" value={form.pan ?? ''} onChange={(e) => set({ pan: e.target.value })} />
              </Field>
              <Field label="Phone" htmlFor="co-phone">
                <Input disabled={disabled} value={form.phone ?? ''} onChange={(e) => set({ phone: e.target.value })} />
              </Field>
              <Field label="Email" htmlFor="co-email">
                <Input disabled={disabled} value={form.email ?? ''} onChange={(e) => set({ email: e.target.value })} />
              </Field>
              <Field label="Address" htmlFor="co-line1" className="sm:col-span-2">
                <Input disabled={disabled} value={form.address?.line1 ?? ''} onChange={(e) => setA({ line1: e.target.value })} />
              </Field>
              <Field label="City" htmlFor="co-city">
                <Input disabled={disabled} value={form.address?.city ?? ''} onChange={(e) => setA({ city: e.target.value })} />
              </Field>
              <Field label="State" htmlFor="co-state">
                <Input disabled={disabled} value={form.address?.state ?? ''} onChange={(e) => setA({ state: e.target.value })} />
              </Field>
              <Field label="PIN code" htmlFor="co-pin">
                <Input disabled={disabled} value={form.address?.pincode ?? ''} onChange={(e) => setA({ pincode: e.target.value })} />
              </Field>
            </CardContent>
          </Card>
        )}
        {section === 'settings' && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Sales & receipts</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Overpayments"
                  htmlFor="co-over"
                  hint="What happens when a receipt exceeds the outstanding dues"
                  className="sm:col-span-2"
                >
                  <Select
                    disabled={disabled}
                    value={form.settings.overpaymentPolicy}
                    onChange={(e) => setS({ overpaymentPolicy: e.target.value })}
                  >
                    {OVERPAYMENT_POLICIES.map((p) => (
                      <option key={p} value={p}>
                        {p === 'advance' ? 'Accept and hold as customer advance' : 'Reject the receipt'}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Default reservation hold (hours)" htmlFor="co-hold">
                  <Input
                    disabled={disabled}
                    inputMode="numeric"
                    value={String(form.settings.reservationHoldHours)}
                    onChange={(e) => setS({ reservationHoldHours: Number(e.target.value) || 0 })}
                  />
                </Field>
                <div />
                <Field label="Booking number prefix" htmlFor="co-bp">
                  <Input
                    disabled={disabled}
                    className="uppercase"
                    value={form.settings.bookingPrefix}
                    onChange={(e) => setS({ bookingPrefix: e.target.value.toUpperCase() })}
                  />
                </Field>
                <Field label="Receipt number prefix" htmlFor="co-rp">
                  <Input
                    disabled={disabled}
                    className="uppercase"
                    value={form.settings.receiptPrefix}
                    onChange={(e) => setS({ receiptPrefix: e.target.value.toUpperCase() })}
                  />
                </Field>
                <Field label="Quotation validity (days)" htmlFor="co-qv">
                  <Input
                    disabled={disabled}
                    inputMode="numeric"
                    value={String(form.settings.quotationValidityDays ?? 15)}
                    onChange={(e) => setS({ quotationValidityDays: Number(e.target.value) || 0 })}
                  />
                </Field>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Post sales & collections</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Field label="Demand letters include dues within (days)" htmlFor="co-dl">
                  <Input
                    disabled={disabled}
                    inputMode="numeric"
                    value={String(form.settings.demandLeadDays ?? 15)}
                    onChange={(e) => setS({ demandLeadDays: Number(e.target.value) || 0 })}
                  />
                </Field>
                <Field label="Late payment interest (% per month)" htmlFor="co-li" hint="Printed on demand letters">
                  <Input
                    disabled={disabled}
                    inputMode="decimal"
                    value={String((form.settings.lateInterestBpPerMonth ?? 0) / 100)}
                    onChange={(e) => setS({ lateInterestBpPerMonth: Math.round(Number(e.target.value || 0) * 100) })}
                  />
                </Field>
                <div className="flex items-center gap-2 sm:col-span-2">
                  <Checkbox
                    id="co-reg"
                    disabled={disabled}
                    checked={form.settings.registryRequiresFullPayment ?? true}
                    onCheckedChange={(c) => setS({ registryRequiresFullPayment: c === true })}
                  />
                  <Label htmlFor="co-reg">Require full payment before sale-deed registry</Label>
                </div>
                <div className="flex items-center gap-2 sm:col-span-2">
                  <Checkbox
                    id="co-pos"
                    disabled={disabled}
                    checked={form.settings.possessionRequiresFullPayment ?? true}
                    onCheckedChange={(c) => setS({ possessionRequiresFullPayment: c === true })}
                  />
                  <Label htmlFor="co-pos">Require full payment before possession</Label>
                </div>
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  An authorised user can still proceed with an override and a written remark.
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>
      {!disabled && (
        <div className="mt-4 flex justify-end">
          <Button loading={save.isPending} onClick={() => save.mutate(form)}>
            <Save /> Save settings
          </Button>
        </div>
      )}
    </>
  );
}

const pwForm = changePasswordSchema
  .extend({ confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

export function AccountPage() {
  const { context } = useAuth();
  const qc = useQueryClient();
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () =>
      api.get<{ id: string; userAgent?: string; ip?: string; createdAt: string; lastUsedAt?: string; current: boolean }[]>(
        '/auth/sessions',
      ),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/auth/sessions/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sessions'] });
      toast.success('Session signed out');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const form = useForm<z.infer<typeof pwForm>>({ resolver: zodResolver(pwForm) });
  const change = useMutation({
    mutationFn: (v: z.infer<typeof pwForm>) =>
      api.post('/auth/change-password', { currentPassword: v.currentPassword, newPassword: v.newPassword }),
    onSuccess: () => {
      form.reset();
      qc.invalidateQueries({ queryKey: ['sessions'] });
      toast.success('Password changed. Other sessions were signed out.');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <>
      <PageHeader title="Account & security" description={`${context?.user.name} · ${context?.user.email}`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4" onSubmit={form.handleSubmit((v) => change.mutate(v))} noValidate>
              <Field label="Current password" htmlFor="cp-current" error={form.formState.errors.currentPassword?.message}>
                <Input type="password" autoComplete="current-password" {...form.register('currentPassword')} />
              </Field>
              <Field label="New password" htmlFor="cp-new" error={form.formState.errors.newPassword?.message}>
                <Input type="password" autoComplete="new-password" {...form.register('newPassword')} />
              </Field>
              <Field label="Confirm new password" htmlFor="cp-confirm" error={form.formState.errors.confirm?.message}>
                <Input type="password" autoComplete="new-password" {...form.register('confirm')} />
              </Field>
              <Button type="submit" className="justify-self-start" loading={change.isPending}>
                Update password
              </Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Active sessions</CardTitle>
            <CardDescription>Sign out devices you don’t recognise.</CardDescription>
          </CardHeader>
          <CardContent>
            {sessions.isPending ? (
              <PageSkeleton />
            ) : (
              <ul className="divide-y">
                {sessions.data?.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <Monitor className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="truncate text-sm">{s.userAgent ?? 'Unknown device'}</p>
                        <p className="text-xs text-muted-foreground">
                          {s.ip} · last active {s.lastUsedAt ? formatDateTime(s.lastUsedAt) : formatDateTime(s.createdAt)}
                        </p>
                      </div>
                    </div>
                    {s.current ? (
                      <span className="text-xs font-medium text-green-700">This device</span>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => revoke.mutate(s.id)}>
                        Sign out
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
