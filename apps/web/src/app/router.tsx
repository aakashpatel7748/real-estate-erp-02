import * as React from 'react';
import { createBrowserRouter, Navigate, NavLink, useLocation, type RouteObject } from 'react-router-dom';
import type { Permission, SalesDocKind } from '@erp/shared';
import { useAuth } from '@/features/auth/auth-context';
import {
  AcceptInvitePage,
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
  SelectCompanyPage,
  VerifyEmailPage,
} from '@/features/auth/auth-pages';
import { AppLayout } from '@/layouts/app-layout';
import { ProjectProvider } from '@/hooks/use-project';
import { PageSkeleton, PermissionDenied, EmptyState } from '@/components/states';
import { cn } from '@/lib/utils';

// Route-level code splitting: each feature module loads on first visit.
const lazy = <T, K extends keyof T>(loader: () => Promise<T>, name: K) =>
  React.lazy(() => loader().then((m) => ({ default: m[name] as unknown as React.ComponentType })));
const lazyWith = <P, T, K extends keyof T>(loader: () => Promise<T>, name: K) =>
  React.lazy(() => loader().then((m) => ({ default: m[name] as unknown as React.ComponentType<P> })));

const DashboardPage = lazy(() => import('@/features/dashboard/dashboard-page'), 'DashboardPage');
const ProjectsPage = lazy(() => import('@/features/projects/projects-pages'), 'ProjectsPage');
const ProjectDetailPage = lazy(() => import('@/features/projects/projects-pages'), 'ProjectDetailPage');
const InventoryPage = lazy(() => import('@/features/inventory/inventory-page'), 'InventoryPage');
const MapPage = lazy(() => import('@/features/map/map-page'), 'MapPage');
const CustomersPage = lazy(() => import('@/features/customers/customers-pages'), 'CustomersPage');
const CustomerDetailPage = lazy(() => import('@/features/customers/customers-pages'), 'CustomerDetailPage');
const BookingsPage = lazy(() => import('@/features/bookings/bookings-pages'), 'BookingsPage');
const NewBookingPage = lazy(() => import('@/features/bookings/bookings-pages'), 'NewBookingPage');
const BookingDetailPage = lazy(() => import('@/features/bookings/bookings-pages'), 'BookingDetailPage');
const PaymentPlansPage = lazy(() => import('@/features/bookings/payment-plans-page'), 'PaymentPlansPage');
const PaymentsPage = lazy(() => import('@/features/payments/payments-pages'), 'PaymentsPage');
const PaymentDetailPage = lazy(() => import('@/features/payments/payments-pages'), 'PaymentDetailPage');
const AccountingPage = lazy(() => import('@/features/accounting/accounting-pages'), 'AccountingPage');
const JournalEntryPage = lazy(() => import('@/features/accounting/accounting-pages'), 'JournalEntryPage');
const UsersPage = lazy(() => import('@/features/admin/admin-pages'), 'UsersPage');
const RolesPage = lazy(() => import('@/features/admin/admin-pages'), 'RolesPage');
const AuditPage = lazy(() => import('@/features/admin/admin-pages'), 'AuditPage');
const CompanySettingsPage = lazyWith<
  { section: 'profile' | 'settings' },
  typeof import('@/features/admin/admin-pages'),
  'CompanySettingsPage'
>(() => import('@/features/admin/admin-pages'), 'CompanySettingsPage');
const AccountPage = lazy(() => import('@/features/admin/admin-pages'), 'AccountPage');
const LandPage = lazy(() => import('@/features/land/land-pages'), 'LandPage');
const LandDetailPage = lazy(() => import('@/features/land/land-pages'), 'LandDetailPage');
const CrmPage = lazy(() => import('@/features/crm/crm-pages'), 'CrmPage');
const BrokersPage = lazy(() => import('@/features/brokers/brokers-pages'), 'BrokersPage');
const BrokerDetailPage = lazy(() => import('@/features/brokers/brokers-pages'), 'BrokerDetailPage');
const VendorsPage = lazy(() => import('@/features/construction/construction-pages'), 'VendorsPage');
const VendorDetailPage = lazy(() => import('@/features/construction/construction-pages'), 'VendorDetailPage');
const WorkOrdersPage = lazy(() => import('@/features/construction/construction-pages'), 'WorkOrdersPage');
const WorkOrderDetailPage = lazy(() => import('@/features/construction/construction-pages'), 'WorkOrderDetailPage');
const ExpensesPage = lazy(() => import('@/features/construction/construction-pages'), 'ExpensesPage');
// Administration
const PhasesTowersPage = lazy(() => import('@/features/administration/administration-pages'), 'PhasesTowersPage');
const BankCashAccountsPage = lazy(() => import('@/features/administration/administration-pages'), 'BankCashAccountsPage');
const RateIndexesPage = lazy(() => import('@/features/administration/administration-pages'), 'RateIndexesPage');
// Masters
const PartiesPage = lazy(() => import('@/features/masters/masters-pages'), 'PartiesPage');
const FinancersPage = lazy(() => import('@/features/masters/masters-pages'), 'FinancersPage');
const ConsultantsPage = lazy(() => import('@/features/masters/masters-pages'), 'ConsultantsPage');
const ChargesPage = lazy(() => import('@/features/masters/masters-pages'), 'ChargesPage');
const ParkingPage = lazy(() => import('@/features/masters/parking-page'), 'ParkingPage');
// Pre sales
const SalesDashboardPage = lazy(() => import('@/features/presales/sales-dashboard'), 'SalesDashboardPage');
const LeadSettingsPage = lazy(() => import('@/features/presales/presales-pages'), 'LeadSettingsPage');
const WhatsappTemplatesPage = lazy(() => import('@/features/presales/presales-pages'), 'WhatsappTemplatesPage');
const IntegrationsPage = lazy(() => import('@/features/presales/presales-pages'), 'IntegrationsPage');
const QuotationsPage = lazy(() => import('@/features/presales/quotations-pages'), 'QuotationsPage');
const NewQuotationPage = lazy(() => import('@/features/presales/quotations-pages'), 'NewQuotationPage');
const QuotationDetailPage = lazy(() => import('@/features/presales/quotations-pages'), 'QuotationDetailPage');
// Post sales
const CancellationsPage = lazy(() => import('@/features/postsales/postsales-pages'), 'CancellationsPage');
const AllotmentsPage = lazy(() => import('@/features/postsales/postsales-pages'), 'AllotmentsPage');
const DuesPage = lazy(() => import('@/features/postsales/dues-page'), 'DuesPage');
const SalesDocsPage = lazyWith<{ kind: SalesDocKind }, typeof import('@/features/postsales/sales-docs-pages'), 'SalesDocsPage'>(
  () => import('@/features/postsales/sales-docs-pages'),
  'SalesDocsPage',
);
const SalesDocDetailPage = lazyWith<{ kind: SalesDocKind }, typeof import('@/features/postsales/sales-docs-pages'), 'SalesDocDetailPage'>(
  () => import('@/features/postsales/sales-docs-pages'),
  'SalesDocDetailPage',
);
// Account
const PdcPage = lazy(() => import('@/features/finance/pdc-page'), 'PdcPage');
const VendorPaymentsPage = lazy(() => import('@/features/finance/finance-pages'), 'VendorPaymentsPage');
const LedgerAdjustmentPage = lazy(() => import('@/features/finance/finance-pages'), 'LedgerAdjustmentPage');
const GstVoucherPage = lazy(() => import('@/features/finance/finance-pages'), 'GstVoucherPage');

/** Route guard: requires a session and a selected company. UX only; the API enforces access. */
function RequireAuth() {
  const { status, context } = useAuth();
  const location = useLocation();
  if (status === 'loading')
    return (
      <div className="p-6">
        <PageSkeleton />
      </div>
    );
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (!context?.activeCompany) return <Navigate to="/select-company" replace />;
  return (
    <ProjectProvider>
      <AppLayout />
    </ProjectProvider>
  );
}

function Guard({ permission, children }: { permission: Permission; children: React.ReactNode }) {
  const { can } = useAuth();
  if (!can(permission)) return <PermissionDenied />;
  return <React.Suspense fallback={<PageSkeleton />}>{children}</React.Suspense>;
}

interface Tab {
  to: string;
  label: string;
  permission: Permission;
  end?: boolean;
}

/** Sub-pages that share one menu item (e.g. inventory list and plot map) as tabs. */
function Tabbed({ tabs, children }: { tabs: Tab[]; children: React.ReactNode }) {
  const { can } = useAuth();
  const visible = tabs.filter((t) => can(t.permission));
  return (
    <>
      {visible.length > 1 && (
        <nav aria-label="Section" className="-mt-2 mb-5 flex gap-1 overflow-x-auto border-b">
          {visible.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                cn(
                  '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                  isActive ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                )
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      )}
      {children}
    </>
  );
}

const TABS = {
  inventory: [
    { to: '/master/units-inventory', label: 'Units / Inventory', permission: 'inventory.read', end: true },
    { to: '/master/units-inventory/map', label: 'Layout map', permission: 'map.read' },
  ],
  land: [
    { to: '/master/land-owners-partners', label: 'Owners & partners', permission: 'masters.read', end: true },
    { to: '/master/land-owners-partners/land', label: 'Land acquisition', permission: 'land.read' },
  ],
  vendors: [
    { to: '/master/vendors-contractors', label: 'Vendors & contractors', permission: 'vendors.read', end: true },
    { to: '/master/vendors-contractors/work-orders', label: 'Work orders', permission: 'construction.read' },
    { to: '/master/vendors-contractors/expenses', label: 'Expenses & bills', permission: 'expenses.read' },
  ],
  rates: [
    { to: '/administration/rate-indexes', label: 'Rate & price indexes', permission: 'inventory.read', end: true },
    { to: '/administration/rate-indexes/payment-plans', label: 'Payment plans', permission: 'paymentPlans.read' },
  ],
  roles: [
    { to: '/administration/roles', label: 'Roles & permissions', permission: 'roles.read', end: true },
    { to: '/administration/roles/users', label: 'Users', permission: 'users.read' },
  ],
} satisfies Record<string, Tab[]>;

function NotFound() {
  return <EmptyState title="Page not found" description="The page you’re looking for doesn’t exist." />;
}

/** Old URLs (bookmarks, notification links) → their place in the new menu. */
const LEGACY: [string, string][] = [
  ['/accounting/entries', '/account/journal-voucher/entries'],
  ['/accounting', '/account/journal-voucher'],
  ['/admin/users', '/administration/roles/users'],
  ['/admin/roles', '/administration/roles'],
  ['/admin/audit', '/administration/activity-log'],
  ['/admin/company', '/administration/company'],
  ['/payment-plans', '/administration/rate-indexes/payment-plans'],
  ['/projects', '/administration/projects'],
  ['/inventory', '/master/units-inventory'],
  ['/map', '/master/units-inventory/map'],
  ['/land', '/master/land-owners-partners/land'],
  ['/crm', '/pre-sales/leads'],
  ['/customers', '/post-sales/customers'],
  ['/bookings', '/post-sales/bookings'],
  ['/payments', '/account/customer-receipts'],
  ['/brokers', '/master/channel-partners'],
  ['/work-orders', '/master/vendors-contractors/work-orders'],
  ['/vendors', '/master/vendors-contractors'],
  ['/expenses', '/master/vendors-contractors/expenses'],
];
function LegacyRedirect({ from, to }: { from: string; to: string }) {
  const { pathname, search } = useLocation();
  return <Navigate to={`${to}${pathname.slice(from.length)}${search}`} replace />;
}

const page = (path: string, permission: Permission, element: React.ReactNode, tabs?: Tab[]): RouteObject => ({
  path,
  element: <Guard permission={permission}>{tabs ? <Tabbed tabs={tabs}>{element}</Tabbed> : element}</Guard>,
});

const DOC_PATHS: [string, SalesDocKind][] = [
  ['agreements', 'agreement'],
  ['registry', 'registry'],
  ['possession-letters', 'possession'],
  ['demand-letters', 'demand'],
];

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/verify-email', element: <VerifyEmailPage /> },
  { path: '/accept-invite', element: <AcceptInvitePage /> },
  { path: '/select-company', element: <SelectCompanyPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        index: true,
        element: (
          <Guard permission="dashboard.read">
            <DashboardPage />
          </Guard>
        ),
      },

      // ---------------- Administration ----------------
      page('administration/company', 'company.read', <CompanySettingsPage section="profile" />),
      page('administration/projects', 'projects.read', <ProjectsPage />),
      page('administration/projects/:id', 'projects.read', <ProjectDetailPage />),
      page('administration/phases', 'projects.read', <PhasesTowersPage />),
      page('administration/bank-cash-accounts', 'accounting.read', <BankCashAccountsPage />),
      page('administration/rate-indexes', 'inventory.read', <RateIndexesPage />, TABS.rates),
      page('administration/rate-indexes/payment-plans', 'paymentPlans.read', <PaymentPlansPage />, TABS.rates),
      page('administration/settings', 'company.read', <CompanySettingsPage section="settings" />),
      page('administration/roles', 'roles.read', <RolesPage />, TABS.roles),
      page('administration/roles/users', 'users.read', <UsersPage />, TABS.roles),
      page('administration/activity-log', 'audit.read', <AuditPage />),

      // ---------------- Master ----------------
      page('master/land-owners-partners', 'masters.read', <PartiesPage />, TABS.land),
      page('master/land-owners-partners/land', 'land.read', <LandPage />, TABS.land),
      page('master/land-owners-partners/land/:id', 'land.read', <LandDetailPage />),
      page('master/channel-partners', 'brokers.read', <BrokersPage />),
      page('master/channel-partners/:id', 'brokers.read', <BrokerDetailPage />),
      page('master/vendors-contractors', 'vendors.read', <VendorsPage />, TABS.vendors),
      page('master/vendors-contractors/work-orders', 'construction.read', <WorkOrdersPage />, TABS.vendors),
      page('master/vendors-contractors/work-orders/:id', 'construction.read', <WorkOrderDetailPage />),
      page('master/vendors-contractors/expenses', 'expenses.read', <ExpensesPage />, TABS.vendors),
      page('master/vendors-contractors/:id', 'vendors.read', <VendorDetailPage />),
      page('master/banks-financers', 'masters.read', <FinancersPage />),
      page('master/registry-consultants', 'masters.read', <ConsultantsPage />),
      page('master/units-inventory', 'inventory.read', <InventoryPage />, TABS.inventory),
      page('master/units-inventory/map', 'map.read', <MapPage />, TABS.inventory),
      page('master/parking-slots', 'inventory.read', <ParkingPage />),
      page('master/other-charges', 'masters.read', <ChargesPage />),

      // ---------------- Pre sales ----------------
      page('pre-sales/dashboard', 'crm.read', <SalesDashboardPage />),
      page('pre-sales/leads', 'crm.read', <CrmPage />),
      page('pre-sales/lead-settings', 'crm.read', <LeadSettingsPage />),
      page('pre-sales/whatsapp-templates', 'crm.read', <WhatsappTemplatesPage />),
      page('pre-sales/portal-integrations', 'crm.configure', <IntegrationsPage />),
      page('pre-sales/quotations', 'quotations.read', <QuotationsPage />),
      page('pre-sales/quotations/new', 'quotations.create', <NewQuotationPage />),
      page('pre-sales/quotations/:id', 'quotations.read', <QuotationDetailPage />),

      // ---------------- Post sales ----------------
      page('post-sales/customers', 'customers.read', <CustomersPage />),
      page('post-sales/customers/:id', 'customers.read', <CustomerDetailPage />),
      page('post-sales/bookings', 'bookings.read', <BookingsPage />),
      page('post-sales/bookings/new', 'bookings.create', <NewBookingPage />),
      page('post-sales/bookings/:id', 'bookings.read', <BookingDetailPage />),
      page('post-sales/cancellations', 'bookings.read', <CancellationsPage />),
      page('post-sales/allotment-letters', 'postSales.read', <AllotmentsPage />),
      ...DOC_PATHS.flatMap(([path, kind]) => [
        page(`post-sales/${path}`, 'postSales.read', <SalesDocsPage kind={kind} />),
        page(`post-sales/${path}/:id`, 'postSales.read', <SalesDocDetailPage kind={kind} />),
      ]),
      page('post-sales/dues-follow-ups', 'collections.read', <DuesPage />),

      // ---------------- Account ----------------
      page('account/pdc', 'pdc.read', <PdcPage />),
      page('account/payments-out', 'vendors.read', <VendorPaymentsPage />),
      page('account/customer-receipts', 'payments.read', <PaymentsPage />),
      page('account/customer-receipts/:id', 'payments.read', <PaymentDetailPage />),
      page('account/ledger-adjustment', 'accounting.read', <LedgerAdjustmentPage />),
      page('account/journal-voucher', 'accounting.read', <AccountingPage />),
      page('account/journal-voucher/entries/:id', 'accounting.read', <JournalEntryPage />),
      page('account/gst-voucher', 'accounting.read', <GstVoucherPage />),

      {
        path: 'profile',
        element: (
          <React.Suspense fallback={<PageSkeleton />}>
            <AccountPage />
          </React.Suspense>
        ),
      },
      { path: 'account', element: <Navigate to="/profile" replace /> },
      ...LEGACY.flatMap(([from, to]) => [
        { path: from.slice(1), element: <LegacyRedirect from={from} to={to} /> },
        { path: `${from.slice(1)}/*`, element: <LegacyRedirect from={from} to={to} /> },
      ]),
      { path: '*', element: <NotFound /> },
    ],
  },
]);
