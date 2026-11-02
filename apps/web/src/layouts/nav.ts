import { IndianRupee, Loader, UserPlus, Users } from 'lucide-react';
import type { Permission } from '@erp/shared';

export interface NavChild {
  id: string;
  title: string;
  path: string;
  /** Shown only to users with this permission (the API enforces it as well). */
  permission: Permission;
}

export interface NavSection {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: NavChild[];
}

/** Sidebar navigation – Real Estate Builder / Developer Software. */
export const sidebarItems: NavSection[] = [
  {
    id: 'administration',
    title: 'Administration',
    icon: UserPlus,
    children: [
      { id: 'company-profile', title: 'Company Profile', path: '/administration/company', permission: 'company.read' },
      { id: 'projects', title: 'Projects', path: '/administration/projects', permission: 'projects.read' },
      { id: 'phases-towers', title: 'Phases / Towers', path: '/administration/phases', permission: 'projects.read' },
      {
        id: 'bank-cash-accounts',
        title: 'Bank & Cash Accounts',
        path: '/administration/bank-cash-accounts',
        permission: 'accounting.read',
      },
      { id: 'rate-indexes', title: 'Rate & Price Indexes', path: '/administration/rate-indexes', permission: 'inventory.read' },
      { id: 'settings', title: 'Settings', path: '/administration/settings', permission: 'company.read' },
      { id: 'roles-permissions', title: 'Roles & Permissions', path: '/administration/roles', permission: 'roles.read' },
      { id: 'activity-log', title: 'Activity Log', path: '/administration/activity-log', permission: 'audit.read' },
    ],
  },
  {
    id: 'master',
    title: 'Master',
    icon: Users,
    children: [
      { id: 'land-owners-partners', title: 'Land Owners & Partners', path: '/master/land-owners-partners', permission: 'masters.read' },
      { id: 'channel-partners', title: 'Channel Partners (Brokers)', path: '/master/channel-partners', permission: 'brokers.read' },
      { id: 'vendors-contractors', title: 'Vendors & Contractors', path: '/master/vendors-contractors', permission: 'vendors.read' },
      { id: 'banks-financers', title: 'Banks & Home Loan Financers', path: '/master/banks-financers', permission: 'masters.read' },
      {
        id: 'registry-consultants',
        title: 'Registry & Legal Consultants',
        path: '/master/registry-consultants',
        permission: 'masters.read',
      },
      { id: 'units-inventory', title: 'Units / Inventory', path: '/master/units-inventory', permission: 'inventory.read' },
      { id: 'parking-slots', title: 'Parking Slots', path: '/master/parking-slots', permission: 'inventory.read' },
      { id: 'other-charges', title: 'Other Charges (PLC, Club, Maintenance)', path: '/master/other-charges', permission: 'masters.read' },
    ],
  },
  {
    id: 'pre-sales',
    title: 'Pre Sales',
    icon: Loader,
    children: [
      { id: 'sales-dashboard', title: 'Sales Dashboard', path: '/pre-sales/dashboard', permission: 'crm.read' },
      { id: 'leads-enquiries', title: 'Leads & Enquiries', path: '/pre-sales/leads', permission: 'crm.read' },
      { id: 'lead-stages-sources', title: 'Lead Stages & Sources', path: '/pre-sales/lead-settings', permission: 'crm.read' },
      { id: 'whatsapp-templates', title: 'WhatsApp Templates', path: '/pre-sales/whatsapp-templates', permission: 'crm.read' },
      {
        id: 'portal-integrations',
        title: 'Portal Integrations (99acres, MagicBricks)',
        path: '/pre-sales/portal-integrations',
        permission: 'crm.configure',
      },
      { id: 'cost-sheets-quotations', title: 'Cost Sheets & Quotations', path: '/pre-sales/quotations', permission: 'quotations.read' },
    ],
  },
  {
    id: 'post-sales',
    title: 'Post Sales',
    icon: Users,
    children: [
      { id: 'customers-buyers', title: 'Customers / Buyers', path: '/post-sales/customers', permission: 'customers.read' },
      { id: 'unit-bookings', title: 'Unit Bookings', path: '/post-sales/bookings', permission: 'bookings.read' },
      { id: 'booking-cancellations', title: 'Booking Cancellations', path: '/post-sales/cancellations', permission: 'bookings.read' },
      { id: 'builder-buyer-agreements', title: 'Builder Buyer Agreements', path: '/post-sales/agreements', permission: 'postSales.read' },
      { id: 'allotment-letters', title: 'Allotment Letters', path: '/post-sales/allotment-letters', permission: 'postSales.read' },
      { id: 'sale-deed-registry', title: 'Sale Deed Registry', path: '/post-sales/registry', permission: 'postSales.read' },
      { id: 'payment-demand-letters', title: 'Payment Demand Letters', path: '/post-sales/demand-letters', permission: 'postSales.read' },
      { id: 'possession-letters', title: 'Possession Letters', path: '/post-sales/possession-letters', permission: 'postSales.read' },
      { id: 'dues-follow-ups', title: 'Dues & Collection Follow-Ups', path: '/post-sales/dues-follow-ups', permission: 'collections.read' },
    ],
  },
  {
    id: 'account',
    title: 'Account',
    icon: IndianRupee,
    children: [
      { id: 'pdc-management', title: 'Post-Dated Cheques (PDC)', path: '/account/pdc', permission: 'pdc.read' },
      { id: 'payments-out', title: 'Vendor & Contractor Payments', path: '/account/payments-out', permission: 'vendors.read' },
      { id: 'customer-receipts', title: 'Customer Receipts', path: '/account/customer-receipts', permission: 'payments.read' },
      { id: 'ledger-adjustment', title: 'Ledger Adjustment', path: '/account/ledger-adjustment', permission: 'accounting.read' },
      { id: 'journal-voucher', title: 'Journal Voucher', path: '/account/journal-voucher', permission: 'accounting.read' },
      { id: 'gst-voucher', title: 'GST Voucher', path: '/account/gst-voucher', permission: 'accounting.read' },
    ],
  },
];

export default sidebarItems;

/** The menu item a URL belongs to (longest matching path), for highlighting and section expansion. */
export function activeNavItem(pathname: string): { section: NavSection; item: NavChild } | null {
  let best: { section: NavSection; item: NavChild } | null = null;
  for (const section of sidebarItems) {
    for (const item of section.children) {
      if (pathname === item.path || pathname.startsWith(`${item.path}/`)) {
        if (!best || item.path.length > best.item.path.length) best = { section, item };
      }
    }
  }
  return best;
}
