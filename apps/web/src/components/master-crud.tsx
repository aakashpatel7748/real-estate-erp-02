import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Permission } from '@erp/shared';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { titleCase } from '@/lib/format';
import { useListParams } from '@/hooks/use-list-params';
import { useAuth } from '@/features/auth/auth-context';
import { Button } from './ui/button';
import { Checkbox, Input, Label, Select, Textarea } from './ui/primitives';
import { ConfirmDialog, Sheet, SheetContent } from './ui/overlays';
import { DataTable, type Column } from './data-table';
import { Field, PageHeader } from './common';
import { SearchInput } from './search-input';
import { MoneyInput, paiseToInput, toBp, toPaise } from './money';
import { ProjectMultiSelect, ProjectSelect } from './pickers';

type Values = Record<string, unknown>;
type Option = string | { value: string; label: string };

export type FieldDef = {
  name: string;
  label: string;
  required?: boolean;
  span?: 1 | 2;
  hint?: string;
  placeholder?: string;
  /** Hide the field depending on other values. */
  when?: (v: Values) => boolean;
} & (
  | { type: 'text' | 'tel' | 'email' | 'upper' | 'textarea' | 'date' | 'number' }
  | { type: 'select'; options: readonly Option[]; emptyLabel?: string }
  | { type: 'money' | 'percent' | 'checkbox' }
  | { type: 'project'; allowAll?: string }
  | { type: 'projects' }
  | { type: 'custom'; render: (value: unknown, set: (v: unknown) => void, values: Values) => React.ReactNode }
);

export function getPath(obj: Values, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Values)[k] : undefined), obj);
}
function setPath(obj: Values, path: string, value: unknown): Values {
  const [head, ...rest] = path.split('.');
  if (!rest.length) return { ...obj, [head!]: value };
  return { ...obj, [head!]: setPath((obj[head!] as Values) ?? {}, rest.join('.'), value) };
}
const optValue = (o: Option) => (typeof o === 'string' ? o : o.value);
const optLabel = (o: Option) => (typeof o === 'string' ? titleCase(o) : o.label);

/** Row (from the API) → form values: ids for refs, rupee strings for money, % strings for bp. */
function toFormValues(fields: FieldDef[], row: Values | undefined, defaults: Values): Values {
  let out: Values = { ...defaults };
  for (const f of fields) {
    let v = row ? getPath(row, f.name) : getPath(defaults, f.name);
    if (row) {
      if (f.type === 'money') v = paiseToInput(v as number);
      else if (f.type === 'percent') v = v === undefined || v === null ? '' : String((v as number) / 100);
      else if (f.type === 'project') v = (v as { id?: string })?.id ?? v ?? '';
      else if (f.type === 'projects') v = ((v as ({ id: string } | string)[]) ?? []).map((p) => (typeof p === 'string' ? p : p.id));
      else if (f.type === 'date') v = typeof v === 'string' ? v.slice(0, 10) : '';
      else if (f.type === 'number') v = v === undefined || v === null ? '' : String(v);
    }
    if (v === undefined || v === null) v = f.type === 'checkbox' ? false : f.type === 'projects' ? [] : '';
    out = setPath(out, f.name, v);
  }
  return out;
}

/** Form values → API payload; blank optionals are omitted. */
function toPayload(fields: FieldDef[], values: Values): Values {
  let out: Values = {};
  for (const f of fields) {
    if (f.type === 'custom' && f.name.startsWith('_')) continue;
    if (f.when && !f.when(values)) continue;
    const raw = getPath(values, f.name);
    let v: unknown = raw;
    if (f.type === 'money') v = raw === '' ? undefined : toPaise(String(raw));
    else if (f.type === 'percent') v = raw === '' ? undefined : toBp(String(raw));
    else if (f.type === 'number') v = raw === '' ? undefined : Number(raw);
    else if (f.type === 'upper') v = raw ? String(raw).toUpperCase() : undefined;
    else if (typeof raw === 'string') v = raw.trim() === '' ? undefined : raw.trim();
    if (v !== undefined) out = setPath(out, f.name, v);
  }
  return out;
}

export function FormFields({
  fields,
  values,
  onChange,
  errors,
  idPrefix,
}: {
  fields: FieldDef[];
  values: Values;
  onChange: (v: Values) => void;
  errors: Record<string, string>;
  idPrefix: string;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields
        .filter((f) => !f.when || f.when(values))
        .map((f) => {
          const id = `${idPrefix}-${f.name.replace(/\./g, '-')}`;
          const value = getPath(values, f.name);
          const set = (v: unknown) => onChange(setPath(values, f.name, v));
          const span = f.span === 2 || f.type === 'textarea' || f.type === 'projects' ? 'sm:col-span-2' : undefined;
          if (f.type === 'checkbox') {
            return (
              <div key={f.name} className={`flex items-center gap-2 ${span ?? ''}`}>
                <Checkbox id={id} checked={value === true} onCheckedChange={(c) => set(c === true)} />
                <Label htmlFor={id}>{f.label}</Label>
              </div>
            );
          }
          let control: React.ReactElement<{ 'aria-invalid'?: boolean; 'aria-describedby'?: string; id?: string }>;
          switch (f.type) {
            case 'textarea':
              control = <Textarea rows={4} value={String(value ?? '')} onChange={(e) => set(e.target.value)} placeholder={f.placeholder} />;
              break;
            case 'select':
              control = (
                <Select value={String(value ?? '')} onChange={(e) => set(e.target.value)}>
                  {(!f.required || f.emptyLabel) && <option value="">{f.emptyLabel ?? '—'}</option>}
                  {f.options.map((o) => (
                    <option key={optValue(o)} value={optValue(o)}>
                      {optLabel(o)}
                    </option>
                  ))}
                </Select>
              );
              break;
            case 'money':
              control = <MoneyInput value={String(value ?? '')} onChange={(e) => set(e.target.value)} placeholder={f.placeholder} />;
              break;
            case 'percent':
              control = (
                <div className="relative">
                  <Input
                    inputMode="decimal"
                    value={String(value ?? '')}
                    onChange={(e) => set(e.target.value)}
                    className="pr-7"
                    placeholder={f.placeholder}
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                </div>
              );
              break;
            case 'project':
              control = <ProjectSelect value={String(value ?? '')} onChange={set} allowAll={!!f.allowAll} allLabel={f.allowAll} />;
              break;
            case 'projects':
              control = (
                <div>
                  <ProjectMultiSelect value={(value as string[]) ?? []} onChange={set} />
                </div>
              );
              break;
            case 'custom':
              control = <div>{f.render(value, set, values)}</div>;
              break;
            default:
              control = (
                <Input
                  type={f.type === 'upper' ? 'text' : f.type}
                  inputMode={f.type === 'number' ? 'numeric' : undefined}
                  className={f.type === 'upper' ? 'uppercase' : undefined}
                  value={String(value ?? '')}
                  onChange={(e) => set(e.target.value)}
                  placeholder={f.placeholder}
                />
              );
          }
          return (
            <Field key={f.name} label={f.label} htmlFor={id} error={errors[f.name]} hint={f.hint} required={f.required} className={span}>
              {control}
            </Field>
          );
        })}
    </div>
  );
}

export interface MasterCrudProps<T extends { id: string }> {
  title: string;
  description?: string;
  endpoint: string;
  queryKey: string;
  entityLabel: string;
  columns: Column<T>[];
  fields: FieldDef[];
  defaults: Values;
  permissions: { create: Permission; update: Permission; delete?: Permission };
  filters?: { key: string; label: string; options: readonly Option[] }[];
  /** Extra content under the form when editing (linked records, history...). */
  renderDetail?: (row: T) => React.ReactNode;
  rowActions?: (row: T) => React.ReactNode;
  headerExtra?: React.ReactNode;
  sort?: string;
  empty?: React.ReactNode;
  /** Tweak the payload before saving (computed fields). */
  transform?: (payload: Values, values: Values) => Values;
  /** Derive extra form values from a row when editing (inverse of `transform`). */
  prepareForm?: (row: T, values: Values) => Values;
}

/** List + search + filters + create/edit sheet for a master collection. */
export function MasterCrud<T extends { id: string; name?: string }>(props: MasterCrudProps<T>) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const lp = useListParams({ sort: props.sort });
  const [editing, setEditing] = React.useState<T | 'new' | null>(null);
  const [deleting, setDeleting] = React.useState<T | null>(null);
  const filterValues = Object.fromEntries((props.filters ?? []).map((f) => [f.key, lp.filter(f.key)]));
  const q = useQuery({
    queryKey: [props.queryKey, lp.query, filterValues],
    queryFn: () => api.page<T>(props.endpoint, { ...lp.query, ...filterValues }),
  });
  const remove = useMutation({
    mutationFn: (row: T) => api.delete(`${props.endpoint}/${row.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [props.queryKey] });
      setDeleting(null);
      toast.success(`${titleCase(props.entityLabel)} deleted`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const canEdit = can(props.permissions.update);
  const columns: Column<T>[] = [
    ...props.columns,
    {
      key: '_actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (row) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {props.rowActions?.(row)}
          {canEdit && (
            <Button variant="ghost" size="icon-sm" onClick={() => setEditing(row)} aria-label={`Edit ${row.name ?? props.entityLabel}`}>
              <Pencil />
            </Button>
          )}
          {props.permissions.delete && can(props.permissions.delete) && (
            <Button variant="ghost" size="icon-sm" onClick={() => setDeleting(row)} aria-label={`Delete ${row.name ?? props.entityLabel}`}>
              <Trash2 />
            </Button>
          )}
        </div>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        title={props.title}
        description={props.description}
        actions={
          <>
            {props.headerExtra}
            {can(props.permissions.create) && (
              <Button onClick={() => setEditing('new')}>
                <Plus /> New {props.entityLabel}
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput value={lp.q} onChange={lp.setQ} placeholder="Search…" className="w-full sm:w-72" />
        {props.filters?.map((f) => (
          <Select
            key={f.key}
            className="h-9 w-auto"
            value={lp.filter(f.key) ?? ''}
            onChange={(e) => lp.setFilter(f.key, e.target.value || undefined)}
            aria-label={f.label}
          >
            <option value="">{f.label}: all</option>
            {f.options.map((o) => (
              <option key={optValue(o)} value={optValue(o)}>
                {optLabel(o)}
              </option>
            ))}
          </Select>
        ))}
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
        onRowClick={canEdit || props.renderDetail ? (r) => setEditing(r) : undefined}
        empty={props.empty}
      />
      <MasterSheet props={props} editing={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? props.entityLabel}?`}
        description="It will no longer appear in lists or pickers. Records that already use it are not changed."
        destructive
        confirmLabel="Delete"
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </>
  );
}

function MasterSheet<T extends { id: string; name?: string }>({
  props,
  editing,
  onClose,
}: {
  props: MasterCrudProps<T>;
  editing: T | 'new' | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const row = editing && editing !== 'new' ? editing : undefined;
  const [values, setValues] = React.useState<Values>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    if (editing) {
      const v = toFormValues(props.fields, row as Values | undefined, props.defaults);
      setValues(row && props.prepareForm ? props.prepareForm(row, v) : v);
      setErrors({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  const readOnly = row ? !can(props.permissions.update) : !can(props.permissions.create);
  const save = useMutation({
    mutationFn: () => {
      const missing = props.fields.filter(
        (f) => f.required && (!f.when || f.when(values)) && (getPath(values, f.name) === '' || getPath(values, f.name) === undefined),
      );
      if (missing.length) {
        setErrors(Object.fromEntries(missing.map((f) => [f.name, `${f.label} is required`])));
        throw new Error('Fill in the required fields');
      }
      let payload = toPayload(props.fields, values);
      if (props.transform) payload = props.transform(payload, values);
      return row ? api.patch<T>(`${props.endpoint}/${row.id}`, payload) : api.post<T>(props.endpoint, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [props.queryKey] });
      toast.success(`${titleCase(props.entityLabel)} saved`);
      onClose();
    },
    onError: (e) => {
      const fe = fieldErrors(e);
      if (Object.keys(fe).length) setErrors(fe);
      toast.error(errorMessage(e));
    },
  });
  return (
    <Sheet open={!!editing} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        title={row ? `${readOnly ? '' : 'Edit '}${row.name ?? titleCase(props.entityLabel)}` : `New ${props.entityLabel}`}
        footer={
          readOnly ? (
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button loading={save.isPending} onClick={() => save.mutate()}>
                Save
              </Button>
            </>
          )
        }
      >
        <fieldset disabled={readOnly} className="space-y-6">
          <FormFields fields={props.fields} values={values} onChange={setValues} errors={errors} idPrefix={props.queryKey} />
        </fieldset>
        {row && props.renderDetail && <div className="mt-6">{props.renderDetail(row)}</div>}
      </SheetContent>
    </Sheet>
  );
}
