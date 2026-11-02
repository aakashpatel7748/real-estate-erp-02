export const PLOT_STATUSES = ['available', 'reserved', 'booked', 'sold', 'blocked'] as const;
export type PlotStatus = (typeof PLOT_STATUSES)[number];

/** Manual transitions an operator may perform from the inventory screen. */
export const MANUAL_PLOT_TRANSITIONS: Record<PlotStatus, PlotStatus[]> = {
  available: ['blocked'],
  blocked: ['available'],
  reserved: [],
  booked: ['sold'],
  sold: [],
};

export const PLOT_FACINGS = ['north', 'south', 'east', 'west', 'north_east', 'north_west', 'south_east', 'south_west'] as const;
export const PLOT_CATEGORIES = ['residential', 'commercial', 'mixed', 'amenity'] as const;
/** Inventory unit types. Plots are the default; flats/shops use tower (block) and floor. */
export const UNIT_TYPES = ['plot', 'flat', 'villa', 'row_house', 'shop', 'office', 'farm_house', 'other'] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

export const BOOKING_STATUSES = ['reserved', 'booked', 'cancelled', 'expired'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Booking state machine. Terminal states have no outgoing transitions. */
export const BOOKING_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  reserved: ['booked', 'cancelled', 'expired'],
  booked: ['cancelled'],
  cancelled: [],
  expired: [],
};

export function canTransitionBooking(from: BookingStatus, to: BookingStatus): boolean {
  return BOOKING_TRANSITIONS[from].includes(to);
}

export const PROJECT_STATUSES = ['planning', 'active', 'completed', 'on_hold', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PAYMENT_MODES = ['cash', 'cheque', 'upi', 'neft', 'rtgs', 'imps', 'card', 'demand_draft', 'other'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const PAYMENT_STATUSES = ['received', 'reversed'] as const;
export const PAYMENT_KINDS = ['receipt', 'refund'] as const;

export const INSTALLMENT_STATUSES = ['pending', 'partial', 'paid', 'cancelled'] as const;
export type InstallmentStatus = (typeof INSTALLMENT_STATUSES)[number];

export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Normal balance side by account type. */
export const NORMAL_BALANCE: Record<AccountType, 'debit' | 'credit'> = {
  asset: 'debit',
  expense: 'debit',
  liability: 'credit',
  equity: 'credit',
  income: 'credit',
};

export const VOUCHER_TYPES = ['journal', 'receipt', 'payment', 'contra', 'sales', 'reversal'] as const;
export type VoucherType = (typeof VOUCHER_TYPES)[number];

/**
 * System accounts every company gets. Services look these up by `systemKey`,
 * never by name, so users may rename them.
 */
export const SYSTEM_ACCOUNTS = [
  { systemKey: 'cash', code: '1000', name: 'Cash in Hand', type: 'asset' },
  { systemKey: 'bank', code: '1010', name: 'Bank Account', type: 'asset' },
  { systemKey: 'customer_receivable', code: '1100', name: 'Customer Receivables', type: 'asset' },
  { systemKey: 'land_inventory', code: '1300', name: 'Land & Development (WIP)', type: 'asset' },
  { systemKey: 'gst_input_cgst', code: '1510', name: 'Input CGST', type: 'asset' },
  { systemKey: 'gst_input_sgst', code: '1511', name: 'Input SGST', type: 'asset' },
  { systemKey: 'gst_input_igst', code: '1512', name: 'Input IGST', type: 'asset' },
  { systemKey: 'customer_advance', code: '2100', name: 'Customer Advances', type: 'liability' },
  { systemKey: 'refund_payable', code: '2200', name: 'Refunds Payable', type: 'liability' },
  { systemKey: 'vendor_payable', code: '2300', name: 'Vendor Payables', type: 'liability' },
  { systemKey: 'broker_payable', code: '2400', name: 'Brokerage Payable', type: 'liability' },
  { systemKey: 'gst_output_cgst', code: '2510', name: 'Output CGST', type: 'liability' },
  { systemKey: 'gst_output_sgst', code: '2511', name: 'Output SGST', type: 'liability' },
  { systemKey: 'gst_output_igst', code: '2512', name: 'Output IGST', type: 'liability' },
  { systemKey: 'capital', code: '3000', name: "Owner's Capital", type: 'equity' },
  { systemKey: 'plot_sales', code: '4000', name: 'Plot Sales', type: 'income' },
  { systemKey: 'cancellation_income', code: '4100', name: 'Cancellation Charges', type: 'income' },
  { systemKey: 'interest_income', code: '4200', name: 'Interest & Late Fees', type: 'income' },
  { systemKey: 'other_income', code: '4900', name: 'Other Income', type: 'income' },
  { systemKey: 'development_expense', code: '5000', name: 'Development Expenses', type: 'expense' },
  { systemKey: 'admin_expense', code: '5100', name: 'Administrative Expenses', type: 'expense' },
  { systemKey: 'brokerage_expense', code: '5200', name: 'Brokerage & Commission', type: 'expense' },
  { systemKey: 'discount_allowed', code: '5300', name: 'Discounts & Waivers', type: 'expense' },
] as const;
export type SystemAccountKey = (typeof SYSTEM_ACCOUNTS)[number]['systemKey'];

export const OVERPAYMENT_POLICIES = ['reject', 'advance'] as const;
export type OverpaymentPolicy = (typeof OVERPAYMENT_POLICIES)[number];

export const MEMBERSHIP_STATUSES = ['active', 'invited', 'disabled'] as const;

export const LEAD_STATUSES = ['new', 'contacted', 'site_visit', 'negotiation', 'won', 'lost'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const OPEN_LEAD_STATUSES: LeadStatus[] = ['new', 'contacted', 'site_visit', 'negotiation'];
/** Built-in lead sources. Companies can rename, hide or add sources in Lead Stages & Sources. */
export const LEAD_SOURCES = ['walk_in', 'website', 'facebook', 'google', '99acres', 'magicbricks', 'housing', 'broker', 'referral', 'hoarding', 'other'] as const;
export const DEFAULT_LEAD_SOURCE_LABELS: Record<string, string> = {
  walk_in: 'Walk-in',
  website: 'Website',
  facebook: 'Facebook',
  google: 'Google',
  '99acres': '99acres',
  magicbricks: 'MagicBricks',
  housing: 'Housing.com',
  broker: 'Channel partner',
  referral: 'Referral',
  hoarding: 'Hoarding',
  other: 'Other',
};
export const DEFAULT_LEAD_STAGE_LABELS: Record<string, string> = {
  new: 'New',
  contacted: 'Contacted',
  site_visit: 'Site visit',
  negotiation: 'Negotiation',
  won: 'Won',
  lost: 'Lost',
};
export const DEFAULT_LOST_REASONS = ['Budget mismatch', 'Location not suitable', 'Bought elsewhere', 'Not reachable', 'Not interested', 'Duplicate enquiry'];
export const LEAD_ACTIVITY_TYPES = ['call', 'whatsapp', 'email', 'meeting', 'site_visit', 'note', 'status_change'] as const;
export const LAND_STATUSES = ['negotiation', 'agreement', 'registered', 'converted', 'dropped'] as const;
export type LandStatus = (typeof LAND_STATUSES)[number];
/** Land acquisition pipeline; `dropped` is terminal and reachable before registry. */
export const LAND_TRANSITIONS: Record<LandStatus, LandStatus[]> = {
  negotiation: ['agreement', 'dropped'],
  agreement: ['registered', 'dropped'],
  registered: ['converted'],
  converted: [],
  dropped: [],
};
export const LAND_AREA_UNITS = ['sqft', 'sqm', 'acre', 'bigha', 'hectare'] as const;
export const WORK_ORDER_STATUSES = ['draft', 'issued', 'in_progress', 'completed', 'cancelled'] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];
export const WORK_ORDER_TRANSITIONS: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  draft: ['issued', 'cancelled'],
  issued: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};
export const VENDOR_CATEGORIES = ['civil', 'electrical', 'plumbing', 'road', 'landscaping', 'material', 'consultant', 'other'] as const;
export const COMMISSION_STATUSES = ['accrued', 'paid', 'cancelled'] as const;
export const EXPENSE_SETTLEMENTS = ['paid', 'payable'] as const;
export const DOCUMENT_ENTITY_TYPES = ['project', 'land_parcel', 'plot', 'customer', 'booking', 'payment', 'vendor', 'work_order', 'lead', 'company'] as const;
export type DocumentEntityType = (typeof DOCUMENT_ENTITY_TYPES)[number];
export const DOCUMENT_CATEGORIES = ['general', 'agreement', 'registry', 'kyc', 'layout_plan', 'approval', 'invoice', 'receipt', 'photo', 'other'] as const;
/** File types accepted for upload; the server also verifies file signatures (magic bytes). */
export const ALLOWED_UPLOAD_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

// ---------- Masters ----------
export const PARTY_KINDS = ['land_owner', 'partner', 'investor'] as const;
export const FINANCER_TYPES = ['bank', 'hfc', 'nbfc', 'cooperative'] as const;
export const LOAN_STATUSES = ['applied', 'sanctioned', 'disbursed', 'rejected'] as const;
export const CONSULTANT_TYPES = ['registry_agent', 'advocate', 'chartered_accountant', 'architect', 'surveyor', 'other'] as const;
export const PARKING_TYPES = ['covered', 'open', 'stilt', 'basement', 'podium'] as const;
export const PARKING_STATUSES = ['available', 'allotted', 'blocked'] as const;
export const CHARGE_KINDS = ['plc', 'club', 'maintenance', 'parking', 'legal', 'electricity', 'water', 'corpus', 'other'] as const;
export const CHARGE_BASES = ['fixed', 'per_sqft', 'percent'] as const;
export type ChargeBasis = (typeof CHARGE_BASES)[number];
export const CASH_BANK_KINDS = ['bank', 'cash'] as const;

// ---------- Pre sales ----------
export const WHATSAPP_TEMPLATE_CATEGORIES = ['lead_followup', 'site_visit', 'quotation', 'booking', 'payment_reminder', 'demand', 'possession', 'general'] as const;
/** Placeholders a WhatsApp template may use; filled from the lead, customer or booking it is sent for. */
export const WHATSAPP_VARIABLES = ['name', 'phone', 'project', 'company', 'executive', 'booking_no', 'units', 'amount_due', 'due_date', 'total_amount'] as const;
export const PORTALS = ['99acres', 'magicbricks', 'housing', 'facebook', 'google', 'website', 'other'] as const;
export const QUOTATION_STATUSES = ['draft', 'sent', 'accepted', 'converted', 'expired', 'cancelled'] as const;

// ---------- Post sales ----------
export const SALES_DOC_KINDS = ['agreement', 'registry', 'possession', 'demand'] as const;
export type SalesDocKind = (typeof SALES_DOC_KINDS)[number];
export const SALES_DOC_STATUSES: Record<SalesDocKind, readonly string[]> = {
  agreement: ['draft', 'executed', 'registered', 'cancelled'],
  registry: ['scheduled', 'registered', 'cancelled'],
  possession: ['offered', 'handed_over', 'cancelled'],
  demand: ['issued', 'cancelled'],
};
export const SALES_DOC_SERIES: Record<SalesDocKind, string> = { agreement: 'BBA', registry: 'REG', possession: 'POS', demand: 'DMD' };
export const FOLLOWUP_TYPES = ['call', 'visit', 'whatsapp', 'email', 'sms', 'note'] as const;

// ---------- Account ----------
export const PDC_STATUSES = ['received', 'deposited', 'clearing', 'cleared', 'bounced', 'returned', 'cancelled'] as const;
export type PdcStatus = (typeof PDC_STATUSES)[number];
export const ADJUSTMENT_TYPES = ['credit', 'debit'] as const;
export const ADJUSTMENT_REASONS = ['discount', 'waiver', 'interest', 'late_fee', 'rounding', 'other'] as const;
export const GST_DIRECTIONS = ['output', 'input'] as const;
export const GST_RATES_BP = [0, 500, 1200, 1800, 2800] as const;
