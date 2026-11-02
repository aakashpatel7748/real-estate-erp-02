import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CHARGE_BASES, CHARGE_KINDS, CONSULTANT_TYPES, FINANCER_TYPES, PARTY_KINDS } from '@erp/shared';
import { api } from '@/lib/api';
import { formatDate, formatINR, titleCase } from '@/lib/format';
import { Badge } from '@/components/ui/primitives';
import { StatusBadge } from '@/components/common';
import { EmptyState } from '@/components/states';
import { MasterCrud, type FieldDef } from '@/components/master-crud';
import { paiseToInput, toBp, toPaise } from '@/components/money';

const Active = ({ on }: { on: boolean }) => (on ? <Badge variant="success">Active</Badge> : <Badge variant="muted">Inactive</Badge>);
const address: FieldDef[] = [
  { name: 'address.line1', label: 'Address', type: 'text', span: 2 },
  { name: 'address.city', label: 'City', type: 'text' },
  { name: 'address.state', label: 'State', type: 'text' },
];

// ---------------- Land owners & partners ----------------

interface Party {
  id: string;
  kind: string;
  name: string;
  phone?: string;
  email?: string;
  pan?: string;
  shareBp?: number;
  contributionPaise?: number;
  bankName?: string;
  accountNumber?: string;
  isActive: boolean;
  landParcelIds?: { id: string; khasraNumber: string; village: string; status: string }[];
  projectIds?: { id: string; name: string }[];
}

export function PartiesPage() {
  return (
    <MasterCrud<Party>
      title="Land Owners & Partners"
      description="Land owners you buy from, and partners or investors in your projects"
      endpoint="/parties"
      queryKey="parties"
      entityLabel="owner / partner"
      sort="name"
      defaults={{ kind: 'land_owner', isActive: true }}
      filters={[{ key: 'kind', label: 'Type', options: PARTY_KINDS }]}
      permissions={{ create: 'masters.create', update: 'masters.update', delete: 'masters.delete' }}
      fields={[
        { name: 'kind', label: 'Type', type: 'select', required: true, options: PARTY_KINDS },
        { name: 'name', label: 'Name', type: 'text', required: true },
        { name: 'phone', label: 'Phone', type: 'tel' },
        { name: 'email', label: 'Email', type: 'email' },
        { name: 'pan', label: 'PAN', type: 'upper' },
        { name: 'shareBp', label: 'Share / profit ratio', type: 'percent', when: (v) => v.kind !== 'land_owner' },
        { name: 'contributionPaise', label: 'Contribution', type: 'money', hint: 'Capital or land value contributed' },
        { name: 'bankName', label: 'Bank', type: 'text' },
        { name: 'accountNumber', label: 'Account number', type: 'text' },
        { name: 'ifsc', label: 'IFSC', type: 'upper' },
        ...address,
        { name: 'projectIds', label: 'Projects', type: 'projects' },
        { name: 'notes', label: 'Notes', type: 'textarea' },
        { name: 'isActive', label: 'Active', type: 'checkbox' },
      ]}
      columns={[
        { key: 'name', header: 'Name', sortKey: 'name', cell: (r) => <span className="font-medium">{r.name}</span> },
        { key: 'kind', header: 'Type', sortKey: 'kind', cell: (r) => titleCase(r.kind) },
        { key: 'phone', header: 'Phone', cell: (r) => r.phone ?? '—' },
        { key: 'share', header: 'Share', align: 'right', cell: (r) => (r.shareBp ? `${r.shareBp / 100}%` : '—') },
        {
          key: 'contrib',
          header: 'Contribution',
          align: 'right',
          hideOnMobile: true,
          cell: (r) => (r.contributionPaise ? formatINR(r.contributionPaise) : '—'),
        },
        { key: 'projects', header: 'Projects', hideOnMobile: true, cell: (r) => r.projectIds?.map((p) => p.name).join(', ') || '—' },
        { key: 'active', header: 'Status', cell: (r) => <Active on={r.isActive} /> },
      ]}
      empty={
        <EmptyState
          title="No owners or partners yet"
          description="Record land owners, partners and investors with their shares and bank details."
        />
      }
    />
  );
}

// ---------------- Banks & home-loan financers ----------------

interface Financer {
  id: string;
  name: string;
  type: string;
  branch?: string;
  contactPerson?: string;
  phone?: string;
  interestRateBp?: number;
  isActive: boolean;
  approvedProjectIds?: { id: string; name: string }[];
  loans?: number;
  sanctionedPaise?: number;
  disbursedPaise?: number;
}
interface FinancerDetail extends Financer {
  bookings?: {
    id: string;
    bookingNumber: string;
    status: string;
    loan?: { status: string; sanctionedPaise?: number; disbursedPaise?: number; loanAccountNo?: string };
    customerId?: { name: string };
  }[];
}

/** Loaded when the sheet opens, so the list stays light. */
function FinancedBookings({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['financers', id], queryFn: () => api.get<FinancerDetail>(`/financers/${id}`) });
  const rows = q.data?.bookings ?? [];
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">Home loans through this lender ({rows.length})</h3>
      {!rows.length ? (
        <p className="text-sm text-muted-foreground">
          {q.isPending ? 'Loading…' : 'No bookings financed yet. Set the lender on a booking’s Home loan card.'}
        </p>
      ) : (
        <ul className="divide-y rounded-md border text-sm">
          {rows.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <Link to={`/post-sales/bookings/${b.id}`} className="font-medium text-primary hover:underline">
                {b.bookingNumber}
              </Link>
              <span className="truncate text-muted-foreground">{b.customerId?.name}</span>
              <span className="tabular">{b.loan?.sanctionedPaise ? formatINR(b.loan.sanctionedPaise) : '—'}</span>
              {b.loan?.status && <StatusBadge status={b.loan.status} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function FinancersPage() {
  return (
    <MasterCrud<Financer>
      title="Banks & Home Loan Financers"
      description="Lenders that finance your buyers, with project approvals (APF) and loans in progress"
      endpoint="/financers"
      queryKey="financers"
      entityLabel="lender"
      sort="name"
      defaults={{ type: 'bank', isActive: true }}
      filters={[
        {
          key: 'type',
          label: 'Type',
          options: FINANCER_TYPES.map((t) => ({
            value: t,
            label: t === 'hfc' ? 'Housing finance co.' : t === 'nbfc' ? 'NBFC' : titleCase(t),
          })),
        },
      ]}
      permissions={{ create: 'masters.create', update: 'masters.update', delete: 'masters.delete' }}
      fields={[
        { name: 'name', label: 'Lender name', type: 'text', required: true, placeholder: 'State Bank of India' },
        {
          name: 'type',
          label: 'Type',
          type: 'select',
          required: true,
          options: FINANCER_TYPES.map((t) => ({
            value: t,
            label: t === 'hfc' ? 'Housing finance co.' : t === 'nbfc' ? 'NBFC' : titleCase(t),
          })),
        },
        { name: 'branch', label: 'Branch', type: 'text' },
        { name: 'contactPerson', label: 'Contact person', type: 'text' },
        { name: 'phone', label: 'Phone', type: 'tel' },
        { name: 'email', label: 'Email', type: 'email' },
        { name: 'interestRateBp', label: 'Typical interest rate', type: 'percent' },
        { name: 'approvedProjectIds', label: 'Approved projects (APF)', type: 'projects' },
        { name: 'notes', label: 'Notes', type: 'textarea' },
        { name: 'isActive', label: 'Active', type: 'checkbox' },
      ]}
      columns={[
        { key: 'name', header: 'Lender', sortKey: 'name', cell: (r) => <span className="font-medium">{r.name}</span> },
        { key: 'type', header: 'Type', cell: (r) => (r.type === 'hfc' ? 'HFC' : r.type === 'nbfc' ? 'NBFC' : titleCase(r.type)) },
        { key: 'branch', header: 'Branch / contact', cell: (r) => [r.branch, r.contactPerson, r.phone].filter(Boolean).join(' · ') || '—' },
        {
          key: 'apf',
          header: 'Approved projects',
          hideOnMobile: true,
          cell: (r) => r.approvedProjectIds?.map((p) => p.name).join(', ') || '—',
        },
        { key: 'loans', header: 'Active loans', align: 'right', cell: (r) => r.loans ?? 0 },
        {
          key: 'sanctioned',
          header: 'Sanctioned',
          align: 'right',
          cell: (r) => <span className="tabular">{formatINR(r.sanctionedPaise ?? 0)}</span>,
        },
        { key: 'active', header: 'Status', cell: (r) => <Active on={r.isActive} /> },
      ]}
      renderDetail={(r) => <FinancedBookings id={r.id} />}
      empty={<EmptyState title="No lenders yet" description="Add banks and housing finance companies to track your buyers’ home loans." />}
    />
  );
}

// ---------------- Registry & legal consultants ----------------

interface Consultant {
  id: string;
  name: string;
  type: string;
  firm?: string;
  phone?: string;
  email?: string;
  registrationNo?: string;
  feeNote?: string;
  isActive: boolean;
}

export function ConsultantsPage() {
  return (
    <MasterCrud<Consultant>
      title="Registry & Legal Consultants"
      description="Registry agents, advocates, CAs and architects you work with"
      endpoint="/consultants"
      queryKey="consultants"
      entityLabel="consultant"
      sort="name"
      defaults={{ type: 'registry_agent', isActive: true }}
      filters={[{ key: 'type', label: 'Type', options: CONSULTANT_TYPES }]}
      permissions={{ create: 'masters.create', update: 'masters.update', delete: 'masters.delete' }}
      fields={[
        { name: 'name', label: 'Name', type: 'text', required: true },
        { name: 'type', label: 'Type', type: 'select', required: true, options: CONSULTANT_TYPES },
        { name: 'firm', label: 'Firm', type: 'text' },
        { name: 'registrationNo', label: 'Registration / enrolment no.', type: 'text' },
        { name: 'phone', label: 'Phone', type: 'tel' },
        { name: 'email', label: 'Email', type: 'email' },
        { name: 'feeNote', label: 'Fees / terms', type: 'text', span: 2, placeholder: 'e.g. ₹5,000 per registry + actuals' },
        ...address,
        { name: 'isActive', label: 'Active', type: 'checkbox' },
      ]}
      columns={[
        { key: 'name', header: 'Name', sortKey: 'name', cell: (r) => <span className="font-medium">{r.name}</span> },
        { key: 'type', header: 'Type', sortKey: 'type', cell: (r) => titleCase(r.type) },
        { key: 'firm', header: 'Firm', cell: (r) => r.firm ?? '—' },
        { key: 'phone', header: 'Phone', cell: (r) => r.phone ?? '—' },
        { key: 'fee', header: 'Fees', hideOnMobile: true, cell: (r) => r.feeNote ?? '—' },
        { key: 'active', header: 'Status', cell: (r) => <Active on={r.isActive} /> },
      ]}
      empty={
        <EmptyState title="No consultants yet" description="Add registry agents and advocates; registries can then be assigned to them." />
      }
    />
  );
}

// ---------------- Other charges ----------------

interface Charge {
  id: string;
  name: string;
  kind: string;
  basis: string;
  value: number;
  gstBp: number;
  isMandatory: boolean;
  isActive: boolean;
  projectId?: { id: string; name: string } | null;
  createdAt: string;
}

export function chargeValueLabel(c: Pick<Charge, 'basis' | 'value'>) {
  if (c.basis === 'fixed') return `${formatINR(c.value)} per unit`;
  if (c.basis === 'per_sqft') return `${formatINR(c.value)} / sq ft`;
  return `${c.value / 100}% of unit value`;
}

export function ChargesPage() {
  return (
    <MasterCrud<Charge>
      title="Other Charges (PLC, Club, Maintenance)"
      description="Standard charges offered on quotations and bookings. Mandatory charges are added automatically."
      endpoint="/charges"
      queryKey="charges"
      entityLabel="charge"
      sort="kind"
      defaults={{ kind: 'club', basis: 'fixed', gstBp: '18', isActive: true, isMandatory: false }}
      filters={[{ key: 'kind', label: 'Type', options: CHARGE_KINDS }]}
      permissions={{ create: 'masters.create', update: 'masters.update', delete: 'masters.delete' }}
      fields={[
        { name: 'name', label: 'Charge name', type: 'text', required: true, placeholder: 'Club membership' },
        {
          name: 'kind',
          label: 'Type',
          type: 'select',
          required: true,
          options: CHARGE_KINDS.map((k) => ({ value: k, label: k === 'plc' ? 'PLC' : titleCase(k) })),
        },
        { name: 'projectId', label: 'Project', type: 'project', allowAll: 'All projects' },
        {
          name: 'basis',
          label: 'Charged as',
          type: 'select',
          required: true,
          options: CHARGE_BASES.map((b) => ({
            value: b,
            label: b === 'fixed' ? 'Fixed per unit' : b === 'per_sqft' ? 'Per sq ft' : '% of unit value',
          })),
        },
        { name: '_amount', label: 'Amount', type: 'money', when: (v) => v.basis !== 'percent', required: true },
        { name: '_percent', label: 'Percentage', type: 'percent', when: (v) => v.basis === 'percent', required: true },
        { name: 'gstBp', label: 'GST', type: 'percent' },
        { name: 'isMandatory', label: 'Add automatically to every quotation / booking', type: 'checkbox', span: 2 },
        { name: 'isActive', label: 'Active', type: 'checkbox' },
      ]}
      prepareForm={(row, v) => ({
        ...v,
        _amount: row.basis !== 'percent' ? paiseToInput(row.value) : '',
        _percent: row.basis === 'percent' ? String(row.value / 100) : '',
      })}
      transform={(p, v) => {
        const { _amount, _percent, ...rest } = p as Record<string, unknown>;
        void _amount;
        void _percent;
        const value = v.basis === 'percent' ? toBp(String(v._percent ?? '')) : toPaise(String(v._amount ?? ''));
        return { ...rest, value, projectId: v.projectId || null };
      }}
      columns={[
        { key: 'name', header: 'Charge', sortKey: 'name', cell: (r) => <span className="font-medium">{r.name}</span> },
        { key: 'kind', header: 'Type', sortKey: 'kind', cell: (r) => (r.kind === 'plc' ? 'PLC' : titleCase(r.kind)) },
        { key: 'value', header: 'Rate', cell: (r) => chargeValueLabel(r) },
        { key: 'gst', header: 'GST', align: 'right', cell: (r) => (r.gstBp ? `${r.gstBp / 100}%` : '—') },
        { key: 'project', header: 'Project', cell: (r) => r.projectId?.name ?? 'All projects' },
        {
          key: 'mandatory',
          header: 'Auto-add',
          cell: (r) => (r.isMandatory ? <Badge variant="info">Mandatory</Badge> : <span className="text-muted-foreground">Optional</span>),
        },
        { key: 'active', header: 'Status', cell: (r) => <Active on={r.isActive} /> },
        { key: 'created', header: 'Added', hideOnMobile: true, cell: (r) => formatDate(r.createdAt) },
      ]}
      empty={
        <EmptyState
          title="No charges yet"
          description="Add PLC, club, maintenance, legal and other charges once; pick them on every quotation and booking."
        />
      }
    />
  );
}
