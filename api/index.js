// src/serverless.ts
import dns from "dns";
import mongoose6 from "mongoose";

// src/app.ts
import cookieParser from "cookie-parser";
import cors2 from "cors";
import express2, { Router as Router17 } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import mongoose4 from "mongoose";

// src/config/env.ts
import { z } from "zod";
var bool = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");
var defaultAppUrl = process.env.APP_URL ? process.env.APP_URL : process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:5173";
var schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(4e3),
  MONGODB_URI: z.string().min(1).default("mongodb://127.0.0.1:27017/real_estate_erp?replicaSet=rs0"),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  /** Comma-separated list of allowed browser origins. */
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  /** Public URL of the web app, used in email links. */
  APP_URL: z.string().url().default(defaultAppUrl),
  COOKIE_SECURE: bool.optional(),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("Real Estate ERP <no-reply@example.com>"),
  JOBS_ENABLED: bool.default(true),
  FOLLOWUP_REMINDER_CRON: z.string().default("*/30 * * * *"),
  /** `local` (dev/single server) or `s3` (any S3-compatible private bucket). */
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default(process.env.VERCEL ? "/tmp/uploads" : ".data/uploads"),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default("ap-south-1"),
  S3_ENDPOINT: z.string().url().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool.default(false),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(100).default(15),
  FILE_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  RESERVATION_EXPIRY_CRON: z.string().default("*/5 * * * *"),
  INSTALLMENT_REMINDER_CRON: z.string().default("30 3 * * *"),
  // 09:00 IST
  REMINDER_DAYS_AHEAD: z.coerce.number().int().min(0).max(60).default(7),
  LOGIN_RATE_LIMIT_PER_15_MIN: z.coerce.number().int().min(1).default(10),
  ARGON2_MEMORY_KIB: z.coerce.number().int().min(8192).default(19456)
});
function load() {
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:
${issues}`);
  }
  const e = parsed.data;
  const isProd = e.NODE_ENV === "production";
  if (e.STORAGE_DRIVER === "s3" && !e.S3_BUCKET) throw new Error("S3_BUCKET is required when STORAGE_DRIVER=s3");
  if (isProd && /change-me|dev-only/i.test(e.JWT_ACCESS_SECRET)) {
    throw new Error("Refusing to start in production with a placeholder JWT secret");
  }
  return {
    ...e,
    isProd,
    isTest: e.NODE_ENV === "test",
    cookieSecure: e.COOKIE_SECURE ?? (isProd || Boolean(process.env.VERCEL)),
    corsOrigins: e.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
  };
}
var env = load();

// src/db/base.ts
import mongoose, { Schema } from "mongoose";

// src/db/tenant-guard.ts
var QUERY_OPS = [
  "find",
  "findOne",
  "findOneAndUpdate",
  "findOneAndDelete",
  "countDocuments",
  "updateOne",
  "updateMany",
  "deleteOne",
  "deleteMany",
  "distinct"
];
var TenantScopeError = class extends Error {
  constructor(model23, op) {
    super(`Unscoped ${op} on tenant model ${model23}: queries must filter by companyId`);
    this.name = "TenantScopeError";
  }
};
function tenantGuard(schema2) {
  for (const op of QUERY_OPS) {
    schema2.pre(op, function() {
      const opts = this.getOptions();
      if (opts.crossTenant) return;
      const filter = this.getFilter();
      if (!filter || filter.companyId === void 0 || filter.companyId === null) {
        throw new TenantScopeError(this.model.modelName, op);
      }
    });
  }
  schema2.pre("aggregate", function() {
    const opts = this.options;
    if (opts?.crossTenant) return;
    const first = this.pipeline()[0];
    if (!first || !("$match" in first) || first.$match.companyId === void 0) {
      throw new TenantScopeError(this._model.modelName, "aggregate");
    }
  });
}

// src/db/base.ts
mongoose.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    delete ret._id;
    delete ret.passwordHash;
    delete ret.tokenHash;
    return ret;
  }
});
var { ObjectId } = Schema.Types;
var baseOptions = { timestamps: true };
var tenantRef = { type: Schema.Types.ObjectId, ref: "Company", required: true, immutable: true };
function withTenant(schema2) {
  schema2.plugin(tenantGuard);
  return schema2;
}
var addressDef = {
  line1: String,
  line2: String,
  city: String,
  state: String,
  pincode: String
};

// src/db/system.models.ts
import { model, Schema as Schema2 } from "mongoose";
var counterSchema = withTenant(
  new Schema2(
    {
      companyId: tenantRef,
      key: { type: String, required: true },
      seq: { type: Number, required: true, default: 0 }
    },
    baseOptions
  )
);
counterSchema.index({ companyId: 1, key: 1 }, { unique: true });
var Counter = model("Counter", counterSchema);
async function nextSequence(companyId, key, session) {
  const doc = await Counter.findOneAndUpdate({ companyId, key }, { $inc: { seq: 1 } }, { upsert: true, new: true, session });
  return doc.seq;
}
var idempotencySchema = withTenant(
  new Schema2(
    {
      companyId: tenantRef,
      userId: { type: Schema2.Types.ObjectId, ref: "User", required: true },
      key: { type: String, required: true, maxlength: 100 },
      route: { type: String, required: true },
      requestHash: { type: String, required: true },
      state: { type: String, enum: ["in_progress", "completed"], required: true },
      responseStatus: Number,
      responseBody: Schema2.Types.Mixed,
      expiresAt: { type: Date, required: true }
    },
    baseOptions
  )
);
idempotencySchema.index({ companyId: 1, userId: 1, key: 1 }, { unique: true });
idempotencySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
var IdempotencyKey = model("IdempotencyKey", idempotencySchema);

// src/modules/companies/company.model.ts
import { model as model2, Schema as Schema3 } from "mongoose";

// ../../packages/shared/src/constants/permissions.ts
var PERMISSION_GROUPS = {
  dashboard: ["read"],
  company: ["read", "update"],
  users: ["read", "create", "update", "deactivate"],
  roles: ["read", "create", "update", "delete"],
  projects: ["read", "create", "update", "archive"],
  land: ["read", "create", "update", "delete", "pay"],
  inventory: ["read", "create", "update", "status", "delete"],
  map: ["read", "edit"],
  crm: ["read", "create", "update", "assign", "delete", "configure"],
  quotations: ["read", "create", "update"],
  customers: ["read", "create", "update", "delete"],
  brokers: ["read", "create", "update", "payout"],
  bookings: ["read", "create", "confirm", "cancel", "discount"],
  paymentPlans: ["read", "create", "update"],
  payments: ["read", "create", "reverse", "refund"],
  accounting: ["read", "create", "reverse", "manageAccounts", "adjust"],
  pdc: ["read", "create", "update"],
  postSales: ["read", "create", "update"],
  collections: ["read", "create"],
  masters: ["read", "create", "update", "delete"],
  reports: ["read", "export"],
  construction: ["read", "create", "update"],
  vendors: ["read", "create", "update", "pay"],
  expenses: ["read", "create", "reverse"],
  documents: ["read", "upload", "delete"],
  notifications: ["read"],
  audit: ["read"]
};
var ALL_PERMISSIONS = Object.entries(PERMISSION_GROUPS).flatMap(
  ([group, actions]) => actions.map((a) => `${group}.${a}`)
);
var PERMISSION_LABELS = {
  dashboard: "Dashboard",
  company: "Company settings",
  users: "Users",
  roles: "Roles & permissions",
  projects: "Projects",
  land: "Land acquisition",
  inventory: "Units / inventory",
  map: "Plot map",
  crm: "CRM & leads",
  quotations: "Cost sheets & quotations",
  pdc: "Post-dated cheques",
  postSales: "Post-sales documents",
  collections: "Dues & collections",
  masters: "Masters",
  customers: "Customers",
  brokers: "Brokers",
  bookings: "Bookings",
  paymentPlans: "Payment plans",
  payments: "Payments & receipts",
  accounting: "Accounting",
  reports: "Reports",
  construction: "Construction",
  vendors: "Vendors",
  expenses: "Expenses & bills",
  documents: "Documents",
  notifications: "Notifications",
  audit: "Audit logs"
};
var SYSTEM_ROLES = {
  owner: {
    name: "Owner",
    description: "Full access to everything in the company",
    permissions: ALL_PERMISSIONS
  },
  manager: {
    name: "Project Manager",
    description: "Manages projects, inventory, bookings and collections",
    permissions: ALL_PERMISSIONS.filter(
      (p) => !p.startsWith("roles.") && !["company.update", "users.deactivate", "accounting.manageAccounts"].includes(p)
    )
  },
  sales: {
    name: "Sales Executive",
    description: "Leads, customers, quotations and bookings",
    permissions: [
      "dashboard.read",
      "projects.read",
      "inventory.read",
      "map.read",
      "crm.read",
      "crm.create",
      "crm.update",
      "customers.read",
      "customers.create",
      "customers.update",
      "crm.assign",
      "brokers.read",
      "brokers.create",
      "bookings.read",
      "bookings.create",
      "paymentPlans.read",
      "payments.read",
      "notifications.read",
      "documents.read",
      "documents.upload",
      "quotations.read",
      "quotations.create",
      "quotations.update",
      "masters.read",
      "collections.read",
      "collections.create",
      "postSales.read"
    ]
  },
  accountant: {
    name: "Accountant",
    description: "Receipts, vouchers and financial reports",
    permissions: [
      "dashboard.read",
      "projects.read",
      "inventory.read",
      "customers.read",
      "bookings.read",
      "paymentPlans.read",
      "payments.read",
      "payments.create",
      "payments.reverse",
      "payments.refund",
      "accounting.read",
      "accounting.create",
      "accounting.reverse",
      "reports.read",
      "reports.export",
      "notifications.read",
      "documents.read",
      "documents.upload",
      "land.read",
      "land.pay",
      "brokers.read",
      "brokers.payout",
      "vendors.read",
      "vendors.pay",
      "expenses.read",
      "expenses.create",
      "expenses.reverse",
      "construction.read",
      "masters.read",
      "pdc.read",
      "pdc.create",
      "pdc.update",
      "accounting.adjust",
      "collections.read",
      "collections.create",
      "postSales.read",
      "postSales.create",
      "postSales.update",
      "quotations.read"
    ]
  },
  viewer: {
    name: "Viewer",
    description: "Read-only access",
    permissions: ALL_PERMISSIONS.filter((p) => p.endsWith(".read"))
  }
};

// ../../packages/shared/src/constants/status.ts
var PLOT_STATUSES = ["available", "reserved", "booked", "sold", "blocked"];
var MANUAL_PLOT_TRANSITIONS = {
  available: ["blocked"],
  blocked: ["available"],
  reserved: [],
  booked: ["sold"],
  sold: []
};
var PLOT_FACINGS = ["north", "south", "east", "west", "north_east", "north_west", "south_east", "south_west"];
var PLOT_CATEGORIES = ["residential", "commercial", "mixed", "amenity"];
var UNIT_TYPES = ["plot", "flat", "villa", "row_house", "shop", "office", "farm_house", "other"];
var BOOKING_STATUSES = ["reserved", "booked", "cancelled", "expired"];
var BOOKING_TRANSITIONS = {
  reserved: ["booked", "cancelled", "expired"],
  booked: ["cancelled"],
  cancelled: [],
  expired: []
};
function canTransitionBooking(from, to) {
  return BOOKING_TRANSITIONS[from].includes(to);
}
var PROJECT_STATUSES = ["planning", "active", "completed", "on_hold", "archived"];
var PAYMENT_MODES = ["cash", "cheque", "upi", "neft", "rtgs", "imps", "card", "demand_draft", "other"];
var PAYMENT_STATUSES = ["received", "reversed"];
var PAYMENT_KINDS = ["receipt", "refund"];
var INSTALLMENT_STATUSES = ["pending", "partial", "paid", "cancelled"];
var ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"];
var NORMAL_BALANCE = {
  asset: "debit",
  expense: "debit",
  liability: "credit",
  equity: "credit",
  income: "credit"
};
var VOUCHER_TYPES = ["journal", "receipt", "payment", "contra", "sales", "reversal"];
var SYSTEM_ACCOUNTS = [
  { systemKey: "cash", code: "1000", name: "Cash in Hand", type: "asset" },
  { systemKey: "bank", code: "1010", name: "Bank Account", type: "asset" },
  { systemKey: "customer_receivable", code: "1100", name: "Customer Receivables", type: "asset" },
  { systemKey: "land_inventory", code: "1300", name: "Land & Development (WIP)", type: "asset" },
  { systemKey: "gst_input_cgst", code: "1510", name: "Input CGST", type: "asset" },
  { systemKey: "gst_input_sgst", code: "1511", name: "Input SGST", type: "asset" },
  { systemKey: "gst_input_igst", code: "1512", name: "Input IGST", type: "asset" },
  { systemKey: "customer_advance", code: "2100", name: "Customer Advances", type: "liability" },
  { systemKey: "refund_payable", code: "2200", name: "Refunds Payable", type: "liability" },
  { systemKey: "vendor_payable", code: "2300", name: "Vendor Payables", type: "liability" },
  { systemKey: "broker_payable", code: "2400", name: "Brokerage Payable", type: "liability" },
  { systemKey: "gst_output_cgst", code: "2510", name: "Output CGST", type: "liability" },
  { systemKey: "gst_output_sgst", code: "2511", name: "Output SGST", type: "liability" },
  { systemKey: "gst_output_igst", code: "2512", name: "Output IGST", type: "liability" },
  { systemKey: "capital", code: "3000", name: "Owner's Capital", type: "equity" },
  { systemKey: "plot_sales", code: "4000", name: "Plot Sales", type: "income" },
  { systemKey: "cancellation_income", code: "4100", name: "Cancellation Charges", type: "income" },
  { systemKey: "interest_income", code: "4200", name: "Interest & Late Fees", type: "income" },
  { systemKey: "other_income", code: "4900", name: "Other Income", type: "income" },
  { systemKey: "development_expense", code: "5000", name: "Development Expenses", type: "expense" },
  { systemKey: "admin_expense", code: "5100", name: "Administrative Expenses", type: "expense" },
  { systemKey: "brokerage_expense", code: "5200", name: "Brokerage & Commission", type: "expense" },
  { systemKey: "discount_allowed", code: "5300", name: "Discounts & Waivers", type: "expense" }
];
var OVERPAYMENT_POLICIES = ["reject", "advance"];
var MEMBERSHIP_STATUSES = ["active", "invited", "disabled"];
var LEAD_STATUSES = ["new", "contacted", "site_visit", "negotiation", "won", "lost"];
var OPEN_LEAD_STATUSES = ["new", "contacted", "site_visit", "negotiation"];
var LEAD_SOURCES = [
  "walk_in",
  "website",
  "facebook",
  "google",
  "99acres",
  "magicbricks",
  "housing",
  "broker",
  "referral",
  "hoarding",
  "other"
];
var DEFAULT_LEAD_SOURCE_LABELS = {
  walk_in: "Walk-in",
  website: "Website",
  facebook: "Facebook",
  google: "Google",
  "99acres": "99acres",
  magicbricks: "MagicBricks",
  housing: "Housing.com",
  broker: "Channel partner",
  referral: "Referral",
  hoarding: "Hoarding",
  other: "Other"
};
var DEFAULT_LEAD_STAGE_LABELS = {
  new: "New",
  contacted: "Contacted",
  site_visit: "Site visit",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost"
};
var DEFAULT_LOST_REASONS = [
  "Budget mismatch",
  "Location not suitable",
  "Bought elsewhere",
  "Not reachable",
  "Not interested",
  "Duplicate enquiry"
];
var LEAD_ACTIVITY_TYPES = ["call", "whatsapp", "email", "meeting", "site_visit", "note", "status_change"];
var LAND_STATUSES = ["negotiation", "agreement", "registered", "converted", "dropped"];
var LAND_TRANSITIONS = {
  negotiation: ["agreement", "dropped"],
  agreement: ["registered", "dropped"],
  registered: ["converted"],
  converted: [],
  dropped: []
};
var LAND_AREA_UNITS = ["sqft", "sqm", "acre", "bigha", "hectare"];
var WORK_ORDER_STATUSES = ["draft", "issued", "in_progress", "completed", "cancelled"];
var WORK_ORDER_TRANSITIONS = {
  draft: ["issued", "cancelled"],
  issued: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: []
};
var VENDOR_CATEGORIES = ["civil", "electrical", "plumbing", "road", "landscaping", "material", "consultant", "other"];
var COMMISSION_STATUSES = ["accrued", "paid", "cancelled"];
var EXPENSE_SETTLEMENTS = ["paid", "payable"];
var DOCUMENT_ENTITY_TYPES = [
  "project",
  "land_parcel",
  "plot",
  "customer",
  "booking",
  "payment",
  "vendor",
  "work_order",
  "lead",
  "company"
];
var DOCUMENT_CATEGORIES = [
  "general",
  "agreement",
  "registry",
  "kyc",
  "layout_plan",
  "approval",
  "invoice",
  "receipt",
  "photo",
  "other"
];
var ALLOWED_UPLOAD_TYPES = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx"
};
var PARTY_KINDS = ["land_owner", "partner", "investor"];
var FINANCER_TYPES = ["bank", "hfc", "nbfc", "cooperative"];
var LOAN_STATUSES = ["applied", "sanctioned", "disbursed", "rejected"];
var CONSULTANT_TYPES = ["registry_agent", "advocate", "chartered_accountant", "architect", "surveyor", "other"];
var PARKING_TYPES = ["covered", "open", "stilt", "basement", "podium"];
var PARKING_STATUSES = ["available", "allotted", "blocked"];
var CHARGE_KINDS = ["plc", "club", "maintenance", "parking", "legal", "electricity", "water", "corpus", "other"];
var CHARGE_BASES = ["fixed", "per_sqft", "percent"];
var CASH_BANK_KINDS = ["bank", "cash"];
var WHATSAPP_TEMPLATE_CATEGORIES = [
  "lead_followup",
  "site_visit",
  "quotation",
  "booking",
  "payment_reminder",
  "demand",
  "possession",
  "general"
];
var PORTALS = ["99acres", "magicbricks", "housing", "facebook", "google", "website", "other"];
var QUOTATION_STATUSES = ["draft", "sent", "accepted", "converted", "expired", "cancelled"];
var SALES_DOC_KINDS = ["agreement", "registry", "possession", "demand"];
var SALES_DOC_STATUSES = {
  agreement: ["draft", "executed", "registered", "cancelled"],
  registry: ["scheduled", "registered", "cancelled"],
  possession: ["offered", "handed_over", "cancelled"],
  demand: ["issued", "cancelled"]
};
var SALES_DOC_SERIES = { agreement: "BBA", registry: "REG", possession: "POS", demand: "DMD" };
var FOLLOWUP_TYPES = ["call", "visit", "whatsapp", "email", "sms", "note"];
var PDC_STATUSES = ["received", "deposited", "clearing", "cleared", "bounced", "returned", "cancelled"];
var ADJUSTMENT_TYPES = ["credit", "debit"];
var ADJUSTMENT_REASONS = ["discount", "waiver", "interest", "late_fee", "rounding", "other"];
var GST_DIRECTIONS = ["output", "input"];
var GST_RATES_BP = [0, 500, 1200, 1800, 2800];

// ../../packages/shared/src/money.ts
function assertPaise(value, label = "amount") {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer number of paise`);
  }
}
function divRound(numerator, denominator) {
  if (denominator === 0n) throw new RangeError("Division by zero");
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const r = n % d;
  const rounded = r * 2n >= d ? q + 1n : q;
  return negative ? -rounded : rounded;
}
function toSafe(v, label) {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new RangeError(`${label} overflow`);
  return n;
}
function applyBasisPoints(amount, bp) {
  assertPaise(amount);
  if (!Number.isInteger(bp)) throw new RangeError("basis points must be an integer");
  return toSafe(divRound(BigInt(amount) * BigInt(bp), 10000n), "applyBasisPoints");
}
function priceForArea(areaX100, ratePaisePerSqft) {
  if (!Number.isSafeInteger(areaX100) || areaX100 < 0) throw new RangeError("area must be a non-negative integer");
  assertPaise(ratePaisePerSqft, "rate");
  return toSafe(divRound(BigInt(areaX100) * BigInt(ratePaisePerSqft), 100n), "priceForArea");
}
function allocateProportionally(total, weights) {
  assertPaise(total);
  if (weights.length === 0) return [];
  const w = weights.map((x) => {
    if (!Number.isSafeInteger(x) || x < 0) throw new RangeError("weights must be non-negative integers");
    return BigInt(x);
  });
  const wSum = w.reduce((a, b) => a + b, 0n);
  if (wSum === 0n) throw new RangeError("weights must not all be zero");
  const t = BigInt(total);
  const base2 = w.map((x) => t * x / wSum);
  const rem = w.map((x, i) => ({ i, r: t * x - base2[i] * wSum }));
  let leftover = t - base2.reduce((a, b) => a + b, 0n);
  rem.sort((a, b) => b.r > a.r ? 1 : b.r < a.r ? -1 : a.i - b.i);
  for (let k = 0; leftover > 0n; k++, leftover--) base2[rem[k % rem.length].i] += 1n;
  return base2.map((x) => toSafe(x, "allocate"));
}
function formatINR(paise2, opts = {}) {
  const { symbol = true, decimals = true } = opts;
  const negative = paise2 < 0;
  const abs = BigInt(Math.abs(paise2));
  const whole = (abs / 100n).toString();
  const frac = (abs % 100n).toString().padStart(2, "0");
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3 : last3;
  return `${negative ? "-" : ""}${symbol ? "\u20B9" : ""}${grouped}${decimals ? "." + frac : ""}`;
}
function areaToSqft(areaX100) {
  const whole = Math.trunc(areaX100 / 100);
  const frac = Math.abs(areaX100 % 100);
  return frac ? `${whole}.${String(frac).padStart(2, "0")}` : String(whole);
}

// ../../packages/shared/src/dates.ts
var APP_TIME_ZONE = "Asia/Kolkata";
var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isISODate(value) {
  if (!DATE_RE.test(value)) return false;
  const d = /* @__PURE__ */ new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
function parseISODate(value) {
  if (!isISODate(value)) throw new RangeError(`Invalid date: ${value}`);
  return /* @__PURE__ */ new Date(`${value}T00:00:00Z`);
}
function toISODate(date) {
  return date.toISOString().slice(0, 10);
}
function todayInIndia(now = /* @__PURE__ */ new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
function addDays(iso2, days) {
  const d = parseISODate(iso2);
  d.setUTCDate(d.getUTCDate() + days);
  return toISODate(d);
}
function addMonths(iso2, months) {
  const d = parseISODate(iso2);
  const day3 = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day3, lastDay));
  return toISODate(d);
}
function financialYear(iso2) {
  const [y, m] = iso2.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}
function formatDate(value) {
  const d = typeof value === "string" ? new Date(value.length === 10 ? `${value}T00:00:00Z` : value) : value;
  const tz = typeof value === "string" && value.length === 10 ? "UTC" : APP_TIME_ZONE;
  return new Intl.DateTimeFormat("en-IN", { timeZone: tz, day: "2-digit", month: "short", year: "numeric" }).format(d);
}

// ../../packages/shared/src/schedule.ts
var ScheduleError = class extends Error {
};
function dueDateFor(rule, bookingDate, repeatIndex) {
  const offset = repeatIndex * (rule.repeat?.everyMonths ?? 0);
  switch (rule.due.kind) {
    case "on_booking":
      return offset ? addMonths(bookingDate, offset) : bookingDate;
    case "days_after_booking":
      return addMonths(addDays(bookingDate, rule.due.days), offset);
    case "months_after_booking":
      return addMonths(bookingDate, rule.due.months + offset);
    case "fixed_date":
      return offset ? addMonths(rule.due.date, offset) : rule.due.date;
  }
}
function generateSchedule(rules, netAmount, bookingDate) {
  assertPaise(netAmount, "net amount");
  if (netAmount <= 0) throw new ScheduleError("Net amount must be positive");
  if (rules.length === 0) throw new ScheduleError("Payment plan has no rules");
  const balanceRules = rules.filter((r) => r.type === "balance");
  if (balanceRules.length > 1) throw new ScheduleError("Only one balance rule is allowed");
  const ruleAmounts = new Array(rules.length).fill(0);
  if (balanceRules.length === 0) {
    if (rules.some((r) => r.type === "fixed")) {
      throw new ScheduleError("Plans with fixed-amount rules need a balance rule");
    }
    const weights = rules.map((r) => r.type === "percent" ? r.valueBp : 0);
    const total = weights.reduce((a, b) => a + b, 0);
    if (total !== 1e4) throw new ScheduleError(`Percentages must total 100% (got ${total / 100}%)`);
    allocateProportionally(netAmount, weights).forEach((a, i) => ruleAmounts[i] = a);
  } else {
    let allocated = 0;
    rules.forEach((r, i) => {
      if (r.type === "percent") ruleAmounts[i] = applyBasisPoints(netAmount, r.valueBp);
      else if (r.type === "fixed") ruleAmounts[i] = r.amountPaise;
      allocated += ruleAmounts[i];
    });
    const remainder = netAmount - allocated;
    if (remainder < 0) throw new ScheduleError("Plan rules exceed the booking amount");
    ruleAmounts[rules.findIndex((r) => r.type === "balance")] = remainder;
  }
  const out = [];
  rules.forEach((rule, i) => {
    const count = rule.repeat?.count ?? 1;
    const parts = count > 1 ? allocateProportionally(ruleAmounts[i], new Array(count).fill(1)) : [ruleAmounts[i]];
    parts.forEach((amount, k) => {
      if (amount === 0) return;
      out.push({
        sequence: 0,
        name: count > 1 ? `${rule.name} ${k + 1}/${count}` : rule.name,
        dueDate: dueDateFor(rule, bookingDate, k),
        amountPaise: amount
      });
    });
  });
  out.sort((a, b) => a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0);
  out.forEach((x, idx) => x.sequence = idx + 1);
  return out;
}

// ../../packages/shared/src/schemas/common.ts
import { z as z2 } from "zod";
var objectId = z2.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
var isoDate = z2.string().refine(isISODate, "Use a valid date (YYYY-MM-DD)");
var paise = z2.number().int("Amount must be in whole paise").min(0).max(Number.MAX_SAFE_INTEGER);
var positivePaise = paise.refine((v) => v > 0, "Amount must be greater than zero");
var basisPoints = z2.number().int().min(0).max(1e4);
var trimmed = (max = 200) => z2.string().trim().max(max);
var requiredText = (label, max = 200) => z2.string().trim().min(1, `${label} is required`).max(max);
var phone = z2.string().trim().regex(/^\+?[0-9][0-9\s-]{6,16}$/, "Enter a valid phone number");
var email = z2.string().trim().toLowerCase().email("Enter a valid email").max(254);
var pan = z2.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "Enter a valid PAN (e.g. ABCDE1234F)");
var gstin = z2.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]Z[0-9A-Z]$/, "Enter a valid GSTIN");
var pincode = z2.string().trim().regex(/^[1-9][0-9]{5}$/, "Enter a 6-digit PIN code");
var optional = (schema2) => z2.preprocess((v) => v === "" || v === null ? void 0 : v, schema2.optional());
var addressSchema = z2.object({
  line1: trimmed(200).optional(),
  line2: trimmed(200).optional(),
  city: trimmed(100).optional(),
  state: trimmed(100).optional(),
  pincode: optional(pincode)
});
var listQuerySchema = z2.object({
  page: z2.coerce.number().int().min(1).default(1),
  pageSize: z2.coerce.number().int().min(1).max(100).default(20),
  sort: z2.string().regex(/^-?[a-zA-Z0-9_.]+$/).optional(),
  q: z2.string().trim().max(100).optional()
});
var idParam = z2.object({ id: objectId });
function patchSchema(schema2) {
  const shape = {};
  for (const [key, value] of Object.entries(schema2.shape)) {
    const field = value instanceof z2.ZodDefault ? value.unwrap() : value;
    shape[key] = field.optional();
  }
  return z2.object(shape);
}

// ../../packages/shared/src/schemas/auth.ts
import { z as z3 } from "zod";
var passwordSchema = z3.string().min(10, "Use at least 10 characters").max(128, "Use at most 128 characters").refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), "Include upper-case, lower-case letters and a number");
var loginSchema = z3.object({
  email,
  password: z3.string().min(1, "Password is required").max(128)
});
var registerSchema = z3.object({
  name: requiredText("Name", 100),
  email,
  password: passwordSchema,
  companyName: requiredText("Company name", 150)
});
var selectCompanySchema = z3.object({ companyId: objectId });
var forgotPasswordSchema = z3.object({ email });
var resetPasswordSchema = z3.object({
  token: z3.string().min(20).max(200),
  password: passwordSchema
});
var verifyEmailSchema = z3.object({ token: z3.string().min(20).max(200) });
var acceptInviteSchema = z3.object({
  token: z3.string().min(20).max(200),
  name: requiredText("Name", 100).optional(),
  password: passwordSchema.optional()
});
var changePasswordSchema = z3.object({
  currentPassword: z3.string().min(1).max(128),
  newPassword: passwordSchema
});

// ../../packages/shared/src/schemas/admin.ts
import { z as z4 } from "zod";
var permissionEnum = z4.enum(ALL_PERMISSIONS);
var roleSchema = z4.object({
  name: requiredText("Role name", 60),
  description: trimmed(300).optional(),
  permissions: z4.array(permissionEnum).max(ALL_PERMISSIONS.length)
});
var projectAccessSchema = z4.discriminatedUnion("mode", [
  z4.object({ mode: z4.literal("all") }),
  z4.object({ mode: z4.literal("restricted"), projectIds: z4.array(objectId).max(500) })
]);
var inviteUserSchema = z4.object({
  email,
  roleId: objectId,
  projectAccess: projectAccessSchema.default({ mode: "all" })
});
var updateMembershipSchema = z4.object({
  roleId: objectId.optional(),
  projectAccess: projectAccessSchema.optional(),
  status: z4.enum(["active", "disabled"]).optional()
});
var companyUpdateSchema = z4.object({
  name: requiredText("Company name", 150).optional(),
  legalName: trimmed(200).optional(),
  gstin: optional(gstin),
  pan: optional(pan),
  phone: optional(phone),
  email: optional(email),
  address: addressSchema.optional(),
  settings: z4.object({
    overpaymentPolicy: z4.enum(OVERPAYMENT_POLICIES).optional(),
    reservationHoldHours: z4.number().int().min(1).max(24 * 30).optional(),
    receiptPrefix: z4.string().trim().regex(/^[A-Z0-9-]{1,10}$/).optional(),
    bookingPrefix: z4.string().trim().regex(/^[A-Z0-9-]{1,10}$/).optional(),
    /** Quotations expire this many days after they are made. */
    quotationValidityDays: z4.number().int().min(1).max(365).optional(),
    /** Demand letters include installments falling due within this many days. */
    demandLeadDays: z4.number().int().min(0).max(90).optional(),
    /** Block sale-deed registry / possession while dues are outstanding (an override with a remark is still possible). */
    registryRequiresFullPayment: z4.boolean().optional(),
    possessionRequiresFullPayment: z4.boolean().optional(),
    /** Interest on overdue installments, in basis points per month, suggested on the dues screen. */
    lateInterestBpPerMonth: z4.number().int().min(0).max(1e3).optional()
  }).optional()
});

// ../../packages/shared/src/schemas/projects.ts
import { z as z5 } from "zod";
var code = (label) => z5.string().trim().toUpperCase().min(1, `${label} is required`).max(20).regex(/^[A-Z0-9-/]+$/, `${label} may contain letters, digits, - and /`);
var projectSchema = z5.object({
  name: requiredText("Project name", 150),
  code: code("Project code"),
  status: z5.enum(PROJECT_STATUSES).default("planning"),
  description: trimmed(2e3).optional(),
  address: addressSchema.optional(),
  reraNumber: trimmed(60).optional(),
  totalAreaX100: z5.number().int().min(0).optional(),
  launchDate: optional(isoDate),
  defaultRatePaisePerSqft: paise.optional()
});
var projectUpdateSchema = patchSchema(projectSchema);
var phaseSchema = z5.object({
  name: requiredText("Phase name", 100),
  code: code("Phase code"),
  sequence: z5.number().int().min(1).max(999).default(1),
  startDate: optional(isoDate),
  targetDate: optional(isoDate)
});
var blockSchema = z5.object({
  phaseId: optional(objectId),
  name: requiredText("Block name", 100),
  code: code("Block code")
});
var mapShapeSchema = z5.object({
  /** SVG polygon points in map coordinates: "x1,y1 x2,y2 ..." */
  points: z5.string().trim().max(4e3).regex(/^(-?\d+(\.\d+)?,-?\d+(\.\d+)?\s*){3,}$/, "Polygon needs at least 3 points")
});
var plotSchema = z5.object({
  phaseId: optional(objectId),
  blockId: optional(objectId),
  plotNumber: z5.string().trim().toUpperCase().min(1, "Plot number is required").max(20).regex(/^[A-Z0-9-/]+$/, "Plot number may contain letters, digits, - and /"),
  category: z5.enum(PLOT_CATEGORIES).default("residential"),
  unitType: z5.enum(UNIT_TYPES).default("plot"),
  /** Floor number for flats, shops and offices (0 = ground). */
  floor: optional(z5.number().int().min(-5).max(200)),
  /** e.g. "2 BHK", "3 BHK + Study". */
  configuration: optional(trimmed(40)),
  facing: optional(z5.enum(PLOT_FACINGS)),
  areaX100: z5.number().int().positive("Area must be greater than zero"),
  widthFtX100: z5.number().int().min(0).optional(),
  depthFtX100: z5.number().int().min(0).optional(),
  ratePaisePerSqft: paise,
  /** Preferential location charge in basis points (corner, park-facing, etc.). */
  plcBp: basisPoints.default(0),
  isCorner: z5.boolean().default(false),
  remarks: trimmed(500).optional(),
  mapShape: mapShapeSchema.optional()
});
var plotUpdateSchema = patchSchema(plotSchema);
var bulkPlotSchema = z5.object({
  phaseId: optional(objectId),
  blockId: optional(objectId),
  prefix: z5.string().trim().toUpperCase().max(10).regex(/^[A-Z0-9-/]*$/).default(""),
  startNumber: z5.number().int().min(1).max(99999),
  count: z5.number().int().min(1).max(500),
  category: z5.enum(PLOT_CATEGORIES).default("residential"),
  unitType: z5.enum(UNIT_TYPES).default("plot"),
  floor: optional(z5.number().int().min(-5).max(200)),
  configuration: optional(trimmed(40)),
  areaX100: z5.number().int().positive(),
  ratePaisePerSqft: paise,
  plcBp: basisPoints.default(0)
});
var plotStatusChangeSchema = z5.object({
  status: z5.enum(PLOT_STATUSES),
  reason: requiredText("Reason", 300)
});
var plotListQuerySchema = listQuerySchema.extend({
  status: z5.enum(PLOT_STATUSES).optional(),
  phaseId: objectId.optional(),
  blockId: objectId.optional(),
  category: z5.enum(PLOT_CATEGORIES).optional(),
  unitType: z5.enum(UNIT_TYPES).optional()
});
var mapConfigSchema = z5.object({
  width: z5.number().int().min(100).max(2e4),
  height: z5.number().int().min(100).max(2e4),
  backgroundColor: z5.string().regex(/^#[0-9a-fA-F]{6}$/).default("#f8fafc")
});
var mapShapesBulkSchema = z5.object({
  shapes: z5.array(z5.object({ plotId: objectId, points: mapShapeSchema.shape.points.nullable() })).min(1).max(2e3)
});

// ../../packages/shared/src/schemas/sales.ts
import { z as z6 } from "zod";
var coApplicantSchema = z6.object({
  name: requiredText("Co-applicant name", 120),
  relation: trimmed(60).optional(),
  phone: optional(phone),
  email: optional(email),
  pan: optional(pan),
  sharePercentBp: basisPoints.optional()
});
var customerSchema = z6.object({
  name: requiredText("Customer name", 120),
  phone,
  altPhone: optional(phone),
  email: optional(email),
  pan: optional(pan),
  /** Only the last 4 digits of Aadhaar are stored. */
  aadhaarLast4: optional(z6.string().regex(/^\d{4}$/, "Enter the last 4 digits")),
  dateOfBirth: optional(isoDate),
  occupation: trimmed(100).optional(),
  address: addressSchema.optional(),
  coApplicants: z6.array(coApplicantSchema).max(5).default([]),
  notes: trimmed(1e3).optional()
});
var customerUpdateSchema = patchSchema(customerSchema);
var bookingChargeSchema = z6.object({
  name: requiredText("Charge name", 80),
  amountPaise: paise
});
var createBookingSchema = z6.object({
  projectId: objectId,
  customerId: objectId,
  plotIds: z6.array(objectId).min(1, "Select at least one plot").max(20),
  paymentPlanId: objectId,
  brokerId: optional(objectId),
  bookingDate: isoDate,
  /** 'reserve' holds the plot until expiry; 'book' confirms immediately. */
  mode: z6.enum(["reserve", "book"]).default("book"),
  reservationHours: z6.number().int().min(1).max(24 * 30).optional(),
  discountPaise: paise.default(0),
  charges: z6.array(bookingChargeSchema).max(10).default([]),
  /** The saved quotation this booking converts, if any. */
  quotationId: optional(objectId),
  remarks: trimmed(1e3).optional()
});
var cancelBookingSchema = z6.object({
  reason: requiredText("Reason", 500),
  /** Amount retained from paid money as cancellation charges. */
  cancellationChargePaise: paise.default(0)
});
var bookingListQuerySchema = listQuerySchema.extend({
  status: z6.enum(BOOKING_STATUSES).optional(),
  customerId: objectId.optional()
});
var quoteSchema = createBookingSchema.pick({
  projectId: true,
  plotIds: true,
  paymentPlanId: true,
  bookingDate: true,
  discountPaise: true,
  charges: true
});
var recordPaymentSchema = z6.object({
  bookingId: objectId,
  amountPaise: positivePaise,
  mode: z6.enum(PAYMENT_MODES),
  receivedOn: isoDate,
  reference: trimmed(100).optional(),
  bankName: trimmed(100).optional(),
  /** Deposit account: cash or a bank account (asset). Defaults by mode. */
  depositAccountId: optional(objectId),
  remarks: trimmed(500).optional()
});
var reversePaymentSchema = z6.object({ reason: requiredText("Reason", 500) });
var refundSchema = z6.object({
  amountPaise: positivePaise,
  mode: z6.enum(PAYMENT_MODES),
  paidOn: isoDate,
  reference: trimmed(100).optional(),
  fromAccountId: optional(objectId),
  remarks: trimmed(500).optional()
});
var paymentListQuerySchema = listQuerySchema.extend({
  bookingId: objectId.optional(),
  customerId: objectId.optional(),
  kind: z6.enum(["receipt", "refund"]).optional(),
  from: isoDate.optional(),
  to: isoDate.optional()
});

// ../../packages/shared/src/schemas/payment-plans.ts
import { z as z7 } from "zod";
var dueRule = z7.discriminatedUnion("kind", [
  z7.object({ kind: z7.literal("on_booking") }),
  z7.object({ kind: z7.literal("days_after_booking"), days: z7.number().int().min(0).max(3650) }),
  z7.object({ kind: z7.literal("months_after_booking"), months: z7.number().int().min(0).max(240) }),
  z7.object({ kind: z7.literal("fixed_date"), date: isoDate })
]);
var repeat = z7.object({
  count: z7.number().int().min(2).max(240),
  everyMonths: z7.number().int().min(1).max(12)
});
var base = { name: requiredText("Installment name", 80), due: dueRule, repeat: repeat.optional() };
var paymentPlanRuleSchema = z7.discriminatedUnion("type", [
  z7.object({ type: z7.literal("percent"), valueBp: basisPoints.refine((v) => v > 0, "Must be above 0%"), ...base }),
  z7.object({ type: z7.literal("fixed"), amountPaise: positivePaise, ...base }),
  z7.object({ type: z7.literal("balance"), ...base })
]);
var paymentPlanSchema = z7.object({
  name: requiredText("Plan name", 100),
  description: trimmed(500).optional(),
  /** Optional: restrict the plan to one project; omitted = available to all projects. */
  projectId: optional(objectId),
  isActive: z7.boolean().default(true),
  rules: z7.array(paymentPlanRuleSchema).min(1).max(30)
}).superRefine((plan, ctx) => {
  const balance = plan.rules.filter((r) => r.type === "balance").length;
  if (balance > 1) ctx.addIssue({ code: "custom", path: ["rules"], message: "Only one balance rule is allowed" });
  if (balance === 0) {
    if (plan.rules.some((r) => r.type === "fixed"))
      ctx.addIssue({ code: "custom", path: ["rules"], message: "Add a balance rule when using fixed amounts" });
    const total = plan.rules.reduce((s, r) => s + (r.type === "percent" ? r.valueBp : 0), 0);
    if (total !== 1e4)
      ctx.addIssue({ code: "custom", path: ["rules"], message: `Percentages must total 100% (currently ${total / 100}%)` });
  }
});

// ../../packages/shared/src/schemas/accounting.ts
import { z as z8 } from "zod";
var accountSchema = z8.object({
  code: z8.string().trim().regex(/^[0-9A-Z-]{1,12}$/, "Code may contain digits, capitals and -"),
  name: requiredText("Account name", 120),
  type: z8.enum(ACCOUNT_TYPES),
  parentId: optional(objectId),
  description: trimmed(300).optional(),
  isBank: z8.boolean().default(false)
});
var accountUpdateSchema = patchSchema(accountSchema.pick({ name: true, description: true })).extend({
  isActive: z8.boolean().optional()
});
var journalLineSchema = z8.object({
  accountId: objectId,
  debitPaise: paise.default(0),
  creditPaise: paise.default(0),
  narration: trimmed(200).optional()
}).refine((l) => l.debitPaise > 0 !== l.creditPaise > 0, "Each line needs either a debit or a credit");
var journalEntrySchema = z8.object({
  date: isoDate,
  projectId: optional(objectId),
  narration: requiredText("Narration", 500),
  reference: trimmed(100).optional(),
  lines: z8.array(journalLineSchema).min(2, "At least two lines are required").max(50)
}).refine((e) => e.lines.reduce((s, l) => s + l.debitPaise, 0) === e.lines.reduce((s, l) => s + l.creditPaise, 0), {
  message: "Debits and credits must be equal",
  path: ["lines"]
});
var reverseEntrySchema = z8.object({
  reason: requiredText("Reason", 500),
  date: optional(isoDate)
});
var journalListQuerySchema = listQuerySchema.extend({
  from: isoDate.optional(),
  to: isoDate.optional(),
  accountId: objectId.optional(),
  voucherType: z8.string().max(20).optional()
});
var reportRangeSchema = z8.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  projectId: objectId.optional()
});
var asOfSchema = z8.object({ asOf: isoDate.optional(), projectId: objectId.optional() });

// ../../packages/shared/src/schemas/operations.ts
import { z as z9 } from "zod";
var landOwnerSchema = z9.object({
  name: requiredText("Owner name", 120),
  sharePercentBp: basisPoints.optional(),
  phone: optional(phone)
});
var landParcelSchema = z9.object({
  projectId: optional(objectId),
  khasraNumber: requiredText("Khasra number", 40),
  khataNumber: trimmed(40).optional(),
  village: requiredText("Village", 100),
  tehsil: trimmed(100).optional(),
  district: requiredText("District", 100),
  state: requiredText("State", 100),
  /** Area in hundredths of the chosen unit. */
  areaX100: z9.number().int().positive("Area must be greater than zero"),
  areaUnit: z9.enum(LAND_AREA_UNITS).default("sqft"),
  owners: z9.array(landOwnerSchema).max(20).default([]),
  agreedCostPaise: paise.optional(),
  agreementDate: optional(isoDate),
  registryDate: optional(isoDate),
  mutationDone: z9.boolean().default(false),
  notes: trimmed(2e3).optional()
});
var landParcelUpdateSchema = patchSchema(landParcelSchema);
var landStatusSchema = z9.object({
  status: z9.enum(LAND_STATUSES),
  date: optional(isoDate),
  note: trimmed(300).optional()
});
var landPaymentSchema = z9.object({
  amountPaise: positivePaise,
  paidOn: isoDate,
  mode: z9.enum(PAYMENT_MODES),
  fromAccountId: optional(objectId),
  payee: trimmed(120).optional(),
  reference: trimmed(100).optional(),
  remarks: trimmed(500).optional()
});
var landListQuerySchema = listQuerySchema.extend({
  status: z9.enum(LAND_STATUSES).optional(),
  projectId: objectId.optional()
});
var leadSourceKey = z9.string().trim().toLowerCase().regex(/^[a-z0-9_]{1,40}$/, "Invalid lead source");
var leadSchema = z9.object({
  projectId: optional(objectId),
  name: requiredText("Name", 120),
  phone,
  email: optional(email),
  /** A source key from the company's Lead Stages & Sources settings. */
  source: leadSourceKey.default("other"),
  brokerId: optional(objectId),
  budgetMinPaise: paise.optional(),
  budgetMaxPaise: paise.optional(),
  interestedPlotIds: z9.array(objectId).max(20).default([]),
  assignedTo: optional(objectId),
  nextFollowUpAt: optional(z9.string().datetime({ offset: true })),
  notes: trimmed(2e3).optional()
});
var leadUpdateSchema = patchSchema(leadSchema);
var leadStatusSchema = z9.object({
  status: z9.enum(LEAD_STATUSES),
  lostReason: trimmed(300).optional()
}).refine((v) => v.status !== "lost" || v.lostReason && v.lostReason.length > 0, {
  path: ["lostReason"],
  message: "Give a reason for losing the lead"
});
var leadActivitySchema = z9.object({
  type: z9.enum(LEAD_ACTIVITY_TYPES).exclude(["status_change"]),
  summary: requiredText("Summary", 1e3),
  outcome: trimmed(300).optional(),
  /** Schedules the next follow-up on the lead. */
  nextFollowUpAt: optional(z9.string().datetime({ offset: true }))
});
var leadAssignSchema = z9.object({ assignedTo: objectId.nullable() });
var leadListQuerySchema = listQuerySchema.extend({
  status: z9.enum(LEAD_STATUSES).optional(),
  source: leadSourceKey.optional(),
  projectId: objectId.optional(),
  assignedTo: z9.union([objectId, z9.literal("me"), z9.literal("unassigned")]).optional(),
  followUp: z9.enum(["due", "upcoming"]).optional()
});
var brokerSchema = z9.object({
  name: requiredText("Name", 120),
  phone,
  email: optional(email),
  pan: optional(pan),
  firmName: trimmed(120).optional(),
  commissionBp: basisPoints.default(0),
  isActive: z9.boolean().default(true)
});
var brokerPayoutSchema = z9.object({
  commissionIds: z9.array(objectId).min(1, "Select at least one commission").max(200),
  paidOn: isoDate,
  mode: z9.enum(PAYMENT_MODES),
  fromAccountId: optional(objectId),
  reference: trimmed(100).optional()
});
var vendorSchema = z9.object({
  name: requiredText("Vendor name", 150),
  category: z9.enum(VENDOR_CATEGORIES).default("other"),
  phone: optional(phone),
  email: optional(email),
  gstin: optional(gstin),
  pan: optional(pan),
  address: addressSchema.optional(),
  isActive: z9.boolean().default(true)
});
var milestoneSchema = z9.object({
  name: requiredText("Milestone name", 120),
  percentBp: basisPoints.optional(),
  dueDate: optional(isoDate)
});
var workOrderSchema = z9.object({
  projectId: objectId,
  vendorId: objectId,
  title: requiredText("Title", 200),
  scope: trimmed(4e3).optional(),
  amountPaise: positivePaise,
  startDate: optional(isoDate),
  endDate: optional(isoDate),
  milestones: z9.array(milestoneSchema).max(50).default([])
});
var workOrderUpdateSchema = patchSchema(workOrderSchema.omit({ projectId: true, vendorId: true }));
var workOrderStatusSchema = z9.object({ status: z9.enum(WORK_ORDER_STATUSES), note: trimmed(300).optional() });
var milestoneCompleteSchema = z9.object({ completed: z9.boolean(), date: optional(isoDate) });
var workOrderListQuerySchema = listQuerySchema.extend({
  status: z9.enum(WORK_ORDER_STATUSES).optional(),
  projectId: objectId.optional(),
  vendorId: objectId.optional()
});
var expenseSchema = z9.object({
  projectId: optional(objectId),
  vendorId: optional(objectId),
  workOrderId: optional(objectId),
  /** An expense account, or the Land & Development (WIP) asset for capitalised costs. */
  expenseAccountId: objectId,
  date: isoDate,
  amountPaise: positivePaise,
  description: requiredText("Description", 500),
  billNumber: trimmed(60).optional(),
  /** `paid` settles now from cash/bank; `payable` books a vendor payable. */
  settlement: z9.enum(EXPENSE_SETTLEMENTS),
  mode: z9.enum(PAYMENT_MODES).optional(),
  paidFromAccountId: optional(objectId)
}).refine((v) => v.settlement !== "payable" || Boolean(v.vendorId), {
  path: ["vendorId"],
  message: "Choose the vendor this bill is payable to"
});
var expenseListQuerySchema = listQuerySchema.extend({
  projectId: objectId.optional(),
  vendorId: objectId.optional(),
  workOrderId: objectId.optional(),
  from: isoDate.optional(),
  to: isoDate.optional()
});
var vendorPaymentSchema = z9.object({
  amountPaise: positivePaise,
  paidOn: isoDate,
  mode: z9.enum(PAYMENT_MODES),
  fromAccountId: optional(objectId),
  projectId: optional(objectId),
  reference: trimmed(100).optional(),
  remarks: trimmed(500).optional()
});
var documentUploadSchema = z9.object({
  entityType: z9.enum(DOCUMENT_ENTITY_TYPES),
  entityId: objectId,
  category: z9.enum(DOCUMENT_CATEGORIES).default("general"),
  description: trimmed(300).optional()
});
var documentListQuerySchema = z9.object({
  entityType: z9.enum(DOCUMENT_ENTITY_TYPES),
  entityId: objectId
});

// ../../packages/shared/src/schemas/erp.ts
import { z as z10 } from "zod";
var ifsc = z10.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Enter a valid IFSC (e.g. SBIN0001234)");
var accountNumber = z10.string().trim().regex(/^[0-9]{6,20}$/, "Account number should be 6\u201320 digits");
var cashBankAccountSchema = z10.object({
  kind: z10.enum(CASH_BANK_KINDS),
  name: requiredText("Account name", 120),
  bankName: optional(trimmed(120)),
  accountNumber: optional(accountNumber),
  ifsc: optional(ifsc),
  branch: optional(trimmed(120)),
  accountType: optional(z10.enum(["current", "savings", "cc", "od", "escrow"])),
  /** RERA designated (70%) collection account. */
  isReraAccount: z10.boolean().default(false),
  openingBalancePaise: paise.default(0),
  openingDate: optional(isoDate)
});
var cashBankAccountUpdateSchema = patchSchema(
  cashBankAccountSchema.omit({ kind: true, openingBalancePaise: true, openingDate: true })
).extend({ isActive: z10.boolean().optional() });
var rateIndexSchema = z10.object({
  projectId: objectId,
  phaseId: optional(objectId),
  blockId: optional(objectId),
  unitType: optional(z10.enum(UNIT_TYPES)),
  category: optional(z10.enum(PLOT_CATEGORIES)),
  name: requiredText("Name", 120),
  ratePaisePerSqft: positivePaise,
  /** Preferential location charge applied together with the rate, if given. */
  plcBp: optional(basisPoints),
  effectiveFrom: isoDate,
  notes: optional(trimmed(500))
});
var partySchema = z10.object({
  kind: z10.enum(PARTY_KINDS),
  name: requiredText("Name", 150),
  phone: optional(phone),
  email: optional(email),
  pan: optional(pan),
  /** Partnership / profit share in basis points (partners and investors). */
  shareBp: optional(basisPoints),
  /** Capital or land contribution, for reference. */
  contributionPaise: optional(paise),
  bankName: optional(trimmed(120)),
  accountNumber: optional(accountNumber),
  ifsc: optional(ifsc),
  address: addressSchema.optional(),
  landParcelIds: z10.array(objectId).max(50).default([]),
  projectIds: z10.array(objectId).max(50).default([]),
  notes: optional(trimmed(1e3)),
  isActive: z10.boolean().default(true)
});
var financerSchema = z10.object({
  name: requiredText("Name", 150),
  type: z10.enum(FINANCER_TYPES),
  branch: optional(trimmed(120)),
  contactPerson: optional(trimmed(120)),
  phone: optional(phone),
  email: optional(email),
  /** Projects this lender has approved (APF) for home loans. */
  approvedProjectIds: z10.array(objectId).max(100).default([]),
  interestRateBp: optional(basisPoints),
  notes: optional(trimmed(1e3)),
  isActive: z10.boolean().default(true)
});
var consultantSchema = z10.object({
  name: requiredText("Name", 150),
  type: z10.enum(CONSULTANT_TYPES),
  firm: optional(trimmed(150)),
  phone: optional(phone),
  email: optional(email),
  registrationNo: optional(trimmed(60)),
  feeNote: optional(trimmed(300)),
  address: addressSchema.optional(),
  isActive: z10.boolean().default(true)
});
var chargeMasterBaseSchema = z10.object({
  /** Empty = applies to every project. */
  projectId: optional(objectId),
  name: requiredText("Charge name", 80),
  kind: z10.enum(CHARGE_KINDS),
  basis: z10.enum(CHARGE_BASES),
  /** fixed: paise · per_sqft: paise per sq ft · percent: basis points of the unit value. */
  value: z10.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  gstBp: basisPoints.default(0),
  /** Added automatically to new quotations and bookings. */
  isMandatory: z10.boolean().default(false),
  isActive: z10.boolean().default(true)
});
var chargeMasterSchema = chargeMasterBaseSchema.refine((v) => v.basis !== "percent" || v.value <= 1e4, {
  path: ["value"],
  message: "Percentage cannot exceed 100%"
});
var parkingSlotSchema = z10.object({
  projectId: objectId,
  blockId: optional(objectId),
  code: z10.string().trim().toUpperCase().min(1, "Slot code is required").max(20).regex(/^[A-Z0-9-/]+$/, "Use letters, digits, - and /"),
  type: z10.enum(PARKING_TYPES),
  level: optional(trimmed(20)),
  pricePaise: paise.default(0),
  remarks: optional(trimmed(300))
});
var parkingBulkSchema = parkingSlotSchema.omit({ code: true }).extend({
  prefix: z10.string().trim().toUpperCase().max(10).regex(/^[A-Z0-9-/]*$/).default("P-"),
  startNumber: z10.number().int().min(1).max(99999),
  count: z10.number().int().min(1).max(500)
});
var parkingAllotSchema = z10.object({ bookingId: objectId, remarks: optional(trimmed(300)) });
var parkingListQuerySchema = listQuerySchema.extend({
  projectId: objectId.optional(),
  status: z10.enum(PARKING_STATUSES).optional(),
  type: z10.enum(PARKING_TYPES).optional()
});
var bookingLoanSchema = z10.object({
  financerId: objectId,
  status: z10.enum(LOAN_STATUSES),
  loanAccountNo: optional(trimmed(40)),
  sanctionedPaise: optional(paise),
  disbursedPaise: optional(paise),
  sanctionDate: optional(isoDate),
  remarks: optional(trimmed(300))
});
var masterListQuerySchema = listQuerySchema.extend({
  kind: z10.string().max(40).optional(),
  type: z10.string().max(40).optional(),
  projectId: objectId.optional(),
  active: z10.enum(["true", "false"]).optional()
});
var leadSettingsSchema = z10.object({
  sources: z10.array(
    z10.object({
      key: z10.string().trim().toLowerCase().regex(/^[a-z0-9_]{1,40}$/, "Keys use lowercase letters, digits and _"),
      label: requiredText("Label", 60),
      active: z10.boolean().default(true)
    })
  ).min(1).max(50).refine((s) => new Set(s.map((x) => x.key)).size === s.length, "Source keys must be unique"),
  stageLabels: z10.record(z10.enum(LEAD_STATUSES), requiredText("Stage label", 40)),
  lostReasons: z10.array(requiredText("Reason", 100)).max(30)
});
var whatsappTemplateSchema = z10.object({
  name: requiredText("Template name", 80),
  category: z10.enum(WHATSAPP_TEMPLATE_CATEGORIES),
  body: requiredText("Message", 2e3),
  isActive: z10.boolean().default(true)
});
var whatsappRenderSchema = z10.object({
  entityType: z10.enum(["lead", "customer", "booking"]),
  entityId: objectId,
  /** Log the message on the lead timeline (or the booking's follow-ups). */
  log: z10.boolean().default(true)
});
var portalIntegrationSchema = z10.object({
  portal: z10.enum(PORTALS),
  name: requiredText("Name", 80),
  projectId: optional(objectId),
  defaultAssigneeId: optional(objectId),
  isActive: z10.boolean().default(true)
});
var quotationSchema = z10.object({
  projectId: objectId,
  plotIds: z10.array(objectId).min(1, "Select at least one unit").max(20),
  paymentPlanId: objectId,
  leadId: optional(objectId),
  customerId: optional(objectId),
  prospectName: optional(trimmed(120)),
  prospectPhone: optional(phone),
  quoteDate: isoDate,
  validUntil: optional(isoDate),
  discountPaise: paise.default(0),
  charges: z10.array(bookingChargeSchema).max(10).default([]),
  notes: optional(trimmed(1e3))
}).refine((v) => v.leadId || v.customerId || v.prospectName, {
  path: ["prospectName"],
  message: "Choose a lead or customer, or enter the prospect name"
});
var quotationStatusSchema = z10.object({ status: z10.enum(QUOTATION_STATUSES) });
var quotationListQuerySchema = listQuerySchema.extend({
  projectId: objectId.optional(),
  status: z10.enum(QUOTATION_STATUSES).optional(),
  leadId: objectId.optional(),
  customerId: objectId.optional()
});
var salesDashboardQuerySchema = z10.object({
  projectId: objectId.optional(),
  from: optional(isoDate),
  to: optional(isoDate)
});
var agreementDetails = z10.object({
  executedOn: optional(isoDate),
  stampDutyPaise: optional(paise),
  registrationFeePaise: optional(paise),
  registrationNumber: optional(trimmed(60)),
  witnesses: optional(trimmed(300)),
  terms: optional(trimmed(1e4))
});
var registryDetails = z10.object({
  scheduledOn: optional(isoDate),
  registeredOn: optional(isoDate),
  deedNumber: optional(trimmed(60)),
  subRegistrarOffice: optional(trimmed(150)),
  stampDutyPaise: optional(paise),
  registrationFeePaise: optional(paise),
  consultantId: optional(objectId)
});
var possessionDetails = z10.object({
  offeredOn: optional(isoDate),
  handedOverOn: optional(isoDate),
  possessionType: optional(z10.enum(["physical", "paper"])),
  keysHandedTo: optional(trimmed(120))
});
var salesDocCreateSchema = z10.discriminatedUnion("kind", [
  z10.object({
    kind: z10.literal("agreement"),
    bookingId: objectId,
    date: isoDate,
    details: agreementDetails.default({}),
    remarks: optional(trimmed(1e3))
  }),
  z10.object({
    kind: z10.literal("registry"),
    bookingId: objectId,
    date: isoDate,
    details: registryDetails.default({}),
    remarks: optional(trimmed(1e3)),
    /** Proceed even though dues are outstanding (needs a remark). */
    overrideDues: z10.boolean().default(false)
  }),
  z10.object({
    kind: z10.literal("possession"),
    bookingId: objectId,
    date: isoDate,
    details: possessionDetails.default({}),
    remarks: optional(trimmed(1e3)),
    overrideDues: z10.boolean().default(false)
  }),
  z10.object({
    kind: z10.literal("demand"),
    bookingId: objectId,
    date: isoDate,
    /** Include installments due on or before this date. Defaults to date + company lead days. */
    dueUpTo: optional(isoDate),
    payBy: optional(isoDate),
    remarks: optional(trimmed(1e3))
  })
]);
var salesDocUpdateSchema = z10.object({
  status: optional(z10.string().max(30)),
  details: z10.record(z10.string(), z10.unknown()).optional(),
  remarks: optional(trimmed(1e3)),
  overrideDues: z10.boolean().default(false)
});
var demandBulkSchema = z10.object({
  projectId: objectId,
  date: isoDate,
  dueUpTo: optional(isoDate),
  payBy: optional(isoDate)
});
var salesDocListQuerySchema = listQuerySchema.extend({
  kind: z10.enum(SALES_DOC_KINDS),
  projectId: objectId.optional(),
  status: z10.string().max(30).optional(),
  bookingId: objectId.optional()
});
var followUpSchema = z10.object({
  bookingId: objectId,
  type: z10.enum(FOLLOWUP_TYPES),
  note: requiredText("Note", 1e3),
  promisedAmountPaise: optional(paise),
  promisedOn: optional(isoDate),
  nextFollowUpOn: optional(isoDate)
});
var duesQuerySchema = listQuerySchema.extend({
  projectId: objectId.optional(),
  bucket: z10.enum(["all", "upcoming", "0_30", "31_60", "61_90", "90_plus"]).default("all"),
  followUp: z10.enum(["due", "none"]).optional()
});
var cancellationsQuerySchema = listQuerySchema.extend({
  projectId: objectId.optional(),
  refund: z10.enum(["pending", "settled"]).optional()
});
var allotmentQuerySchema = listQuerySchema.extend({
  projectId: objectId.optional(),
  issued: z10.enum(["true", "false"]).optional()
});
var pdcSchema = z10.object({
  bookingId: objectId,
  chequeNumber: z10.string().trim().regex(/^[0-9]{6}$/, "Cheque number is 6 digits"),
  bankName: requiredText("Bank name", 120),
  branch: optional(trimmed(120)),
  chequeDate: isoDate,
  amountPaise: positivePaise,
  remarks: optional(trimmed(300))
});
var pdcDepositSchema = z10.object({ depositedOn: isoDate, depositAccountId: optional(objectId) });
var pdcClearSchema = z10.object({ clearedOn: isoDate });
var pdcBounceSchema = z10.object({ bouncedOn: isoDate, reason: requiredText("Reason", 300) });
var pdcReturnSchema = z10.object({ reason: requiredText("Reason", 300) });
var pdcListQuerySchema = listQuerySchema.extend({
  projectId: objectId.optional(),
  status: z10.enum(PDC_STATUSES).optional(),
  bookingId: objectId.optional(),
  /** Cheques dated on or before today that are still with us. */
  due: z10.enum(["true"]).optional(),
  from: optional(isoDate),
  to: optional(isoDate)
});
var ledgerAdjustmentSchema = z10.object({
  bookingId: objectId,
  type: z10.enum(ADJUSTMENT_TYPES),
  reason: z10.enum(ADJUSTMENT_REASONS),
  amountPaise: positivePaise,
  date: isoDate,
  /** The other side of the entry: an income account for debits, an expense/income account for credits. Defaults by reason. */
  accountId: optional(objectId),
  /** Due date of the new charge (debits). Defaults to the adjustment date. */
  dueDate: optional(isoDate),
  narration: requiredText("Narration", 500)
});
var gstVoucherSchema = z10.object({
  direction: z10.enum(GST_DIRECTIONS),
  date: isoDate,
  invoiceNumber: requiredText("Invoice number", 40),
  partyName: requiredText("Party name", 150),
  partyGstin: optional(gstin),
  placeOfSupply: optional(trimmed(60)),
  interState: z10.boolean().default(false),
  hsnSac: optional(trimmed(12)),
  description: requiredText("Description", 300),
  taxableValuePaise: positivePaise,
  rateBp: z10.number().int().refine((v) => GST_RATES_BP.includes(v), "Choose a GST rate"),
  /** Income account (output) or expense / asset account (input). */
  accountId: objectId,
  /** Settled now through this cash/bank account... */
  settlementAccountId: optional(objectId),
  mode: optional(z10.enum(PAYMENT_MODES)),
  /** ...or, for purchases, booked as payable to this vendor. */
  vendorId: optional(objectId),
  projectId: optional(objectId)
}).refine((v) => !(v.vendorId && v.direction === "output"), { path: ["vendorId"], message: "Vendors apply to purchase (input) vouchers" });
var gstListQuerySchema = listQuerySchema.extend({
  direction: z10.enum(GST_DIRECTIONS).optional(),
  from: optional(isoDate),
  to: optional(isoDate)
});
var vendorPaymentListQuerySchema = listQuerySchema.extend({
  vendorId: objectId.optional(),
  projectId: objectId.optional(),
  from: optional(isoDate),
  to: optional(isoDate)
});

// src/modules/companies/company.model.ts
var companySchema = new Schema3(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    slug: { type: String, required: true, unique: true, lowercase: true },
    legalName: String,
    gstin: String,
    pan: String,
    phone: String,
    email: String,
    address: addressDef,
    settings: {
      overpaymentPolicy: { type: String, enum: OVERPAYMENT_POLICIES, default: "advance" },
      reservationHoldHours: { type: Number, default: 72, min: 1 },
      receiptPrefix: { type: String, default: "RCPT" },
      bookingPrefix: { type: String, default: "BKG" },
      quotationValidityDays: { type: Number, default: 15 },
      demandLeadDays: { type: Number, default: 15 },
      registryRequiresFullPayment: { type: Boolean, default: true },
      possessionRequiresFullPayment: { type: Boolean, default: true },
      lateInterestBpPerMonth: { type: Number, default: 150 }
    },
    /** Lead sources, stage labels and lost reasons (Pre Sales → Lead Stages & Sources). */
    leadSettings: {
      sources: [{ _id: false, key: String, label: String, active: { type: Boolean, default: true } }],
      stageLabels: { type: Schema3.Types.Mixed },
      lostReasons: [String]
    },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema3.Types.ObjectId, ref: "User" }
  },
  baseOptions
);
var Company = model2("Company", companySchema);

// src/modules/users/user.models.ts
import { model as model3, Schema as Schema4 } from "mongoose";
var userSchema = new Schema4(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, select: false },
    emailVerifiedAt: Date,
    isActive: { type: Boolean, default: true },
    lastLoginAt: Date,
    failedLoginCount: { type: Number, default: 0 },
    lockedUntil: Date,
    /** Marks development seed accounts so deploy checks can refuse to run with them enabled. */
    isDevSeed: { type: Boolean, default: false }
  },
  baseOptions
);
var User = model3("User", userSchema);
var membershipSchema = withTenant(
  new Schema4(
    {
      companyId: tenantRef,
      userId: { type: Schema4.Types.ObjectId, ref: "User", required: true },
      roleId: { type: Schema4.Types.ObjectId, ref: "Role", required: true },
      status: { type: String, enum: MEMBERSHIP_STATUSES, default: "active", required: true },
      projectAccess: {
        mode: { type: String, enum: ["all", "restricted"], default: "all", required: true },
        projectIds: [{ type: Schema4.Types.ObjectId, ref: "Project" }]
      },
      invitedBy: { type: Schema4.Types.ObjectId, ref: "User" }
    },
    baseOptions
  )
);
membershipSchema.index({ companyId: 1, userId: 1 }, { unique: true });
membershipSchema.index({ userId: 1, status: 1 });
var Membership = model3("Membership", membershipSchema);

// src/modules/roles/role.models.ts
import { model as model4, Schema as Schema5 } from "mongoose";
var roleSchema2 = withTenant(
  new Schema5(
    {
      companyId: tenantRef,
      name: { type: String, required: true, trim: true, maxlength: 60 },
      /** Stable key for system roles (owner, manager, ...). Absent for custom roles. */
      systemKey: String,
      description: String,
      permissions: {
        type: [{ type: String, enum: ALL_PERMISSIONS }],
        default: []
      },
      isSystem: { type: Boolean, default: false }
    },
    baseOptions
  )
);
roleSchema2.index({ companyId: 1, name: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });
roleSchema2.index({ companyId: 1, systemKey: 1 }, { unique: true, partialFilterExpression: { systemKey: { $type: "string" } } });
var Role = model4("Role", roleSchema2);
var permissionSchema = new Schema5(
  {
    key: { type: String, required: true, unique: true },
    group: { type: String, required: true },
    action: { type: String, required: true },
    label: String
  },
  baseOptions
);
var Permission = model4("Permission", permissionSchema);

// src/modules/auth/auth.models.ts
import { model as model5, Schema as Schema6 } from "mongoose";
var sessionSchema = new Schema6(
  {
    userId: { type: Schema6.Types.ObjectId, ref: "User", required: true },
    tokenHash: { type: String, required: true, unique: true },
    previousTokenHash: { type: String },
    rotatedAt: Date,
    activeCompanyId: { type: Schema6.Types.ObjectId, ref: "Company" },
    userAgent: String,
    ip: String,
    expiresAt: { type: Date, required: true },
    lastUsedAt: Date,
    revokedAt: Date,
    revokedReason: String
  },
  baseOptions
);
sessionSchema.index({ userId: 1, revokedAt: 1 });
sessionSchema.index({ previousTokenHash: 1 }, { sparse: true });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });
var Session = model5("Session", sessionSchema);
var authTokenSchema = new Schema6(
  {
    userId: { type: Schema6.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: ["verify_email", "reset_password"], required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: Date
  },
  baseOptions
);
authTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
var AuthToken = model5("AuthToken", authTokenSchema);
var invitationSchema = withTenant(
  new Schema6(
    {
      companyId: tenantRef,
      email: { type: String, required: true, lowercase: true, trim: true },
      roleId: { type: Schema6.Types.ObjectId, ref: "Role", required: true },
      projectAccess: {
        mode: { type: String, enum: ["all", "restricted"], default: "all" },
        projectIds: [{ type: Schema6.Types.ObjectId, ref: "Project" }]
      },
      tokenHash: { type: String, required: true, unique: true },
      status: { type: String, enum: ["pending", "accepted", "revoked"], default: "pending" },
      expiresAt: { type: Date, required: true },
      acceptedAt: Date,
      invitedBy: { type: Schema6.Types.ObjectId, ref: "User", required: true }
    },
    baseOptions
  )
);
invitationSchema.index({ companyId: 1, email: 1, status: 1 });
var Invitation = model5("Invitation", invitationSchema);

// src/modules/projects/project.models.ts
import { model as model6, Schema as Schema7 } from "mongoose";
var projectSchema2 = withTenant(
  new Schema7(
    {
      companyId: tenantRef,
      name: { type: String, required: true, trim: true, maxlength: 150 },
      code: { type: String, required: true, uppercase: true, trim: true, maxlength: 20 },
      status: { type: String, enum: PROJECT_STATUSES, default: "planning", required: true },
      description: String,
      address: addressDef,
      reraNumber: String,
      totalAreaX100: { type: Number, min: 0 },
      launchDate: Date,
      defaultRatePaisePerSqft: { type: Number, min: 0 },
      map: {
        width: { type: Number, default: 1200 },
        height: { type: Number, default: 800 },
        backgroundColor: { type: String, default: "#f8fafc" }
      },
      archivedAt: Date,
      createdBy: { type: Schema7.Types.ObjectId, ref: "User" }
    },
    baseOptions
  )
);
projectSchema2.index({ companyId: 1, code: 1 }, { unique: true });
projectSchema2.index({ companyId: 1, status: 1, createdAt: -1 });
var Project = model6("Project", projectSchema2);
var phaseSchema2 = withTenant(
  new Schema7(
    {
      companyId: tenantRef,
      projectId: { type: Schema7.Types.ObjectId, ref: "Project", required: true, immutable: true },
      name: { type: String, required: true, trim: true },
      code: { type: String, required: true, uppercase: true, trim: true },
      sequence: { type: Number, default: 1 },
      startDate: Date,
      targetDate: Date
    },
    baseOptions
  )
);
phaseSchema2.index({ companyId: 1, projectId: 1, code: 1 }, { unique: true });
var ProjectPhase = model6("ProjectPhase", phaseSchema2);
var blockSchema2 = withTenant(
  new Schema7(
    {
      companyId: tenantRef,
      projectId: { type: Schema7.Types.ObjectId, ref: "Project", required: true, immutable: true },
      phaseId: { type: Schema7.Types.ObjectId, ref: "ProjectPhase" },
      name: { type: String, required: true, trim: true },
      code: { type: String, required: true, uppercase: true, trim: true }
    },
    baseOptions
  )
);
blockSchema2.index({ companyId: 1, projectId: 1, code: 1 }, { unique: true });
var Block = model6("Block", blockSchema2);

// src/modules/land/land.model.ts
import { model as model7, Schema as Schema8 } from "mongoose";
var landParcelSchema2 = withTenant(
  new Schema8(
    {
      companyId: tenantRef,
      projectId: { type: Schema8.Types.ObjectId, ref: "Project", default: null },
      khasraNumber: { type: String, required: true, trim: true },
      khataNumber: String,
      village: { type: String, required: true, trim: true },
      tehsil: String,
      district: { type: String, required: true, trim: true },
      state: { type: String, required: true },
      areaX100: { type: Number, required: true, min: 1 },
      areaUnit: { type: String, enum: LAND_AREA_UNITS, default: "sqft" },
      owners: [{ name: { type: String, required: true }, sharePercentBp: Number, phone: String }],
      status: { type: String, enum: LAND_STATUSES, default: "negotiation", required: true },
      statusHistory: [
        {
          from: String,
          to: { type: String, required: true },
          note: String,
          at: { type: Date, default: Date.now },
          by: { type: Schema8.Types.ObjectId, ref: "User" }
        }
      ],
      agreedCostPaise: { type: Number, min: 0 },
      /** Running total of non-reversed payments to owners, maintained transactionally. */
      paidPaise: { type: Number, min: 0, default: 0 },
      agreementDate: Date,
      registryDate: Date,
      mutationDone: { type: Boolean, default: false },
      notes: String,
      createdBy: { type: Schema8.Types.ObjectId, ref: "User" },
      deletedAt: Date
    },
    baseOptions
  )
);
landParcelSchema2.index(
  { companyId: 1, district: 1, village: 1, khasraNumber: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);
landParcelSchema2.index({ companyId: 1, projectId: 1, status: 1 });
var LandParcel = model7("LandParcel", landParcelSchema2);
var landPaymentSchema2 = withTenant(
  new Schema8(
    {
      companyId: tenantRef,
      number: { type: String, required: true, immutable: true },
      landParcelId: { type: Schema8.Types.ObjectId, ref: "LandParcel", required: true },
      projectId: { type: Schema8.Types.ObjectId, ref: "Project" },
      amountPaise: { type: Number, required: true, min: 1, immutable: true },
      date: { type: Date, required: true },
      mode: { type: String, enum: PAYMENT_MODES, required: true },
      accountId: { type: Schema8.Types.ObjectId, ref: "Account", required: true },
      payee: String,
      reference: String,
      remarks: String,
      journalEntryId: { type: Schema8.Types.ObjectId, ref: "JournalEntry" },
      createdBy: { type: Schema8.Types.ObjectId, ref: "User" }
    },
    baseOptions
  )
);
landPaymentSchema2.index({ companyId: 1, number: 1 }, { unique: true });
landPaymentSchema2.index({ companyId: 1, landParcelId: 1, date: 1 });
var LandPayment = model7("LandPayment", landPaymentSchema2);

// src/modules/plots/plot.models.ts
import { model as model8, Schema as Schema9 } from "mongoose";
var plotSchema2 = withTenant(
  new Schema9(
    {
      companyId: tenantRef,
      projectId: { type: Schema9.Types.ObjectId, ref: "Project", required: true, immutable: true },
      phaseId: { type: Schema9.Types.ObjectId, ref: "ProjectPhase", default: null },
      blockId: { type: Schema9.Types.ObjectId, ref: "Block", default: null },
      plotNumber: { type: String, required: true, uppercase: true, trim: true },
      category: { type: String, enum: PLOT_CATEGORIES, default: "residential" },
      unitType: { type: String, enum: UNIT_TYPES, default: "plot" },
      /** Flats, shops and offices: floor number (block = tower). */
      floor: Number,
      configuration: String,
      facing: { type: String, enum: PLOT_FACINGS },
      areaX100: { type: Number, required: true, min: 1, validate: Number.isInteger },
      widthFtX100: { type: Number, min: 0 },
      depthFtX100: { type: Number, min: 0 },
      ratePaisePerSqft: { type: Number, required: true, min: 0, validate: Number.isInteger },
      plcBp: { type: Number, default: 0, min: 0, max: 1e4 },
      isCorner: { type: Boolean, default: false },
      /** Derived: area × rate + PLC. Recomputed by the service whenever inputs change. */
      listPricePaise: { type: Number, required: true, min: 0, validate: Number.isInteger },
      status: { type: String, enum: PLOT_STATUSES, default: "available", required: true },
      currentBookingId: { type: Schema9.Types.ObjectId, ref: "Booking", default: null },
      mapShape: { points: String },
      remarks: String,
      deletedAt: Date
    },
    baseOptions
  )
);
plotSchema2.index({ companyId: 1, projectId: 1, blockId: 1, plotNumber: 1 }, { unique: true });
plotSchema2.index({ companyId: 1, projectId: 1, status: 1 });
plotSchema2.index({ companyId: 1, projectId: 1, unitType: 1 });
plotSchema2.index({ companyId: 1, projectId: 1, createdAt: -1 });
var Plot = model8("Plot", plotSchema2);
var historySchema = withTenant(
  new Schema9(
    {
      companyId: tenantRef,
      projectId: { type: Schema9.Types.ObjectId, ref: "Project", required: true },
      plotId: { type: Schema9.Types.ObjectId, ref: "Plot", required: true },
      from: { type: String, enum: [...PLOT_STATUSES, null] },
      to: { type: String, enum: PLOT_STATUSES, required: true },
      reason: String,
      bookingId: { type: Schema9.Types.ObjectId, ref: "Booking" },
      actorId: { type: Schema9.Types.ObjectId, ref: "User" }
    },
    { ...baseOptions, timestamps: { createdAt: true, updatedAt: false } }
  )
);
historySchema.index({ companyId: 1, plotId: 1, createdAt: -1 });
var PlotStatusHistory = model8("PlotStatusHistory", historySchema);

// src/modules/crm/crm.models.ts
import { model as model9, Schema as Schema10 } from "mongoose";
var leadSchema2 = withTenant(
  new Schema10(
    {
      companyId: tenantRef,
      projectId: { type: Schema10.Types.ObjectId, ref: "Project" },
      name: { type: String, required: true, trim: true },
      phone: { type: String, required: true },
      email: String,
      /** Key from the company's configurable lead sources (see lead-settings). */
      source: { type: String, default: "other", maxlength: 40 },
      brokerId: { type: Schema10.Types.ObjectId, ref: "Broker" },
      status: { type: String, enum: LEAD_STATUSES, default: "new", required: true },
      budgetMinPaise: Number,
      budgetMaxPaise: Number,
      interestedPlotIds: [{ type: Schema10.Types.ObjectId, ref: "Plot" }],
      assignedTo: { type: Schema10.Types.ObjectId, ref: "User" },
      nextFollowUpAt: Date,
      lostReason: String,
      customerId: { type: Schema10.Types.ObjectId, ref: "Customer" },
      convertedAt: Date,
      notes: String,
      lastActivityAt: Date,
      lastReminderOn: Date,
      createdBy: { type: Schema10.Types.ObjectId, ref: "User" },
      deletedAt: Date
    },
    baseOptions
  )
);
leadSchema2.index({ companyId: 1, status: 1, nextFollowUpAt: 1 });
leadSchema2.index({ companyId: 1, assignedTo: 1, status: 1 });
leadSchema2.index({ companyId: 1, phone: 1 });
leadSchema2.index({ companyId: 1, projectId: 1, status: 1, createdAt: -1 });
leadSchema2.index({ status: 1, nextFollowUpAt: 1 });
var Lead = model9("Lead", leadSchema2);
var leadActivitySchema2 = withTenant(
  new Schema10(
    {
      companyId: tenantRef,
      leadId: { type: Schema10.Types.ObjectId, ref: "Lead", required: true },
      type: { type: String, enum: ["call", "whatsapp", "email", "meeting", "site_visit", "note", "status_change"], required: true },
      summary: { type: String, required: true },
      outcome: String,
      scheduledAt: Date,
      completedAt: Date,
      actorId: { type: Schema10.Types.ObjectId, ref: "User", required: true }
    },
    baseOptions
  )
);
leadActivitySchema2.index({ companyId: 1, leadId: 1, createdAt: -1 });
var LeadActivity = model9("LeadActivity", leadActivitySchema2);

// src/modules/customers/customer.models.ts
import { model as model10, Schema as Schema11 } from "mongoose";
var coApplicantSchema2 = new Schema11(
  {
    name: { type: String, required: true },
    relation: String,
    phone: String,
    email: String,
    pan: String,
    sharePercentBp: Number
  },
  { _id: true }
);
var customerSchema2 = withTenant(
  new Schema11(
    {
      companyId: tenantRef,
      customerCode: { type: String, required: true },
      name: { type: String, required: true, trim: true, maxlength: 120 },
      phone: { type: String, required: true, trim: true },
      altPhone: String,
      email: { type: String, lowercase: true, trim: true },
      pan: { type: String, uppercase: true },
      aadhaarLast4: String,
      dateOfBirth: Date,
      occupation: String,
      address: addressDef,
      coApplicants: { type: [coApplicantSchema2], default: [] },
      notes: String,
      leadId: { type: Schema11.Types.ObjectId, ref: "Lead" },
      createdBy: { type: Schema11.Types.ObjectId, ref: "User" },
      deletedAt: Date
    },
    baseOptions
  )
);
customerSchema2.index({ companyId: 1, customerCode: 1 }, { unique: true });
customerSchema2.index({ companyId: 1, phone: 1 });
customerSchema2.index({ companyId: 1, name: 1 });
customerSchema2.index({ companyId: 1, createdAt: -1 });
var Customer = model10("Customer", customerSchema2);
var brokerSchema2 = withTenant(
  new Schema11(
    {
      companyId: tenantRef,
      name: { type: String, required: true, trim: true },
      phone: { type: String, required: true },
      email: String,
      pan: String,
      firmName: String,
      /** Default commission in basis points of the booking net amount. */
      commissionBp: { type: Number, default: 0, min: 0, max: 1e4 },
      isActive: { type: Boolean, default: true }
    },
    baseOptions
  )
);
brokerSchema2.index({ companyId: 1, phone: 1 }, { unique: true });
var Broker = model10("Broker", brokerSchema2);

// src/modules/bookings/booking.models.ts
import { model as model11, Schema as Schema12 } from "mongoose";
var paymentPlanSchema2 = withTenant(
  new Schema12(
    {
      companyId: tenantRef,
      projectId: { type: Schema12.Types.ObjectId, ref: "Project", default: null },
      name: { type: String, required: true, trim: true },
      description: String,
      isActive: { type: Boolean, default: true },
      /** Validated by `paymentPlanSchema` (Zod) before persisting. */
      rules: { type: [Schema12.Types.Mixed], required: true }
    },
    baseOptions
  )
);
paymentPlanSchema2.index({ companyId: 1, name: 1 }, { unique: true });
var PaymentPlan = model11("PaymentPlan", paymentPlanSchema2);
var chargeSchema = new Schema12(
  { name: { type: String, required: true }, amountPaise: { type: Number, required: true, min: 0 } },
  { _id: false }
);
var bookingSchema = withTenant(
  new Schema12(
    {
      companyId: tenantRef,
      projectId: { type: Schema12.Types.ObjectId, ref: "Project", required: true, immutable: true },
      bookingNumber: { type: String, required: true, immutable: true },
      customerId: { type: Schema12.Types.ObjectId, ref: "Customer", required: true, immutable: true },
      brokerId: { type: Schema12.Types.ObjectId, ref: "Broker" },
      paymentPlanId: { type: Schema12.Types.ObjectId, ref: "PaymentPlan", required: true },
      /** Snapshot of the plan at booking time, so later plan edits never change a schedule. */
      planSnapshot: { name: String, rules: [Schema12.Types.Mixed] },
      status: { type: String, enum: BOOKING_STATUSES, required: true },
      bookingDate: { type: Date, required: true },
      reservedUntil: Date,
      confirmedAt: Date,
      closedAt: Date,
      cancellation: {
        reason: String,
        chargePaise: Number,
        by: { type: Schema12.Types.ObjectId, ref: "User" },
        journalEntryIds: [{ type: Schema12.Types.ObjectId, ref: "JournalEntry" }]
      },
      grossAmountPaise: { type: Number, required: true, min: 0 },
      discountPaise: { type: Number, required: true, min: 0, default: 0 },
      charges: { type: [chargeSchema], default: [] },
      chargesTotalPaise: { type: Number, required: true, min: 0, default: 0 },
      netAmountPaise: { type: Number, required: true, min: 0 },
      /** Running totals maintained transactionally by the payments service. */
      receivedPaise: { type: Number, required: true, default: 0 },
      allocatedPaise: { type: Number, required: true, default: 0 },
      /** Received money not allocated to any installment (overpayment held as advance). */
      advancePaise: { type: Number, required: true, default: 0 },
      refundedPaise: { type: Number, required: true, default: 0 },
      /** Money owed back to the customer after cancellation (paid minus charges minus refunds). */
      refundablePaise: { type: Number, required: true, default: 0 },
      salesJournalEntryId: { type: Schema12.Types.ObjectId, ref: "JournalEntry" },
      /** Net effect of ledger adjustments (debit notes minus credit notes), included in netAmountPaise. */
      adjustmentsPaise: { type: Number, default: 0 },
      quotationId: { type: Schema12.Types.ObjectId, ref: "Quotation" },
      allotment: {
        issuedAt: Date,
        issuedBy: { type: Schema12.Types.ObjectId, ref: "User" },
        deliveredVia: String
      },
      /** Home loan, if the buyer is financing through a bank / HFC. */
      loan: {
        financerId: { type: Schema12.Types.ObjectId, ref: "Financer" },
        status: { type: String, enum: LOAN_STATUSES },
        loanAccountNo: String,
        sanctionedPaise: Number,
        disbursedPaise: Number,
        sanctionDate: Date,
        remarks: String
      },
      remarks: String,
      createdBy: { type: Schema12.Types.ObjectId, ref: "User", required: true }
    },
    baseOptions
  )
);
bookingSchema.index({ companyId: 1, bookingNumber: 1 }, { unique: true });
bookingSchema.index({ companyId: 1, projectId: 1, status: 1, createdAt: -1 });
bookingSchema.index({ companyId: 1, customerId: 1 });
bookingSchema.index({ companyId: 1, "loan.financerId": 1 }, { sparse: true });
bookingSchema.index({ status: 1, reservedUntil: 1 });
var Booking = model11("Booking", bookingSchema);
var bookingItemSchema = withTenant(
  new Schema12(
    {
      companyId: tenantRef,
      projectId: { type: Schema12.Types.ObjectId, ref: "Project", required: true },
      bookingId: { type: Schema12.Types.ObjectId, ref: "Booking", required: true },
      plotId: { type: Schema12.Types.ObjectId, ref: "Plot", required: true },
      plotNumber: { type: String, required: true },
      blockCode: String,
      areaX100: { type: Number, required: true },
      ratePaisePerSqft: { type: Number, required: true },
      plcBp: { type: Number, required: true },
      basePaise: { type: Number, required: true },
      plcPaise: { type: Number, required: true },
      lineTotalPaise: { type: Number, required: true },
      /** True while the booking holds the plot. A partial unique index makes double-booking impossible. */
      active: { type: Boolean, required: true, default: true }
    },
    baseOptions
  )
);
bookingItemSchema.index({ plotId: 1 }, { unique: true, partialFilterExpression: { active: true }, name: "one_active_booking_per_plot" });
bookingItemSchema.index({ companyId: 1, bookingId: 1 });
var BookingItem = model11("BookingItem", bookingItemSchema);
var installmentSchema = withTenant(
  new Schema12(
    {
      companyId: tenantRef,
      projectId: { type: Schema12.Types.ObjectId, ref: "Project", required: true },
      bookingId: { type: Schema12.Types.ObjectId, ref: "Booking", required: true },
      customerId: { type: Schema12.Types.ObjectId, ref: "Customer", required: true },
      sequence: { type: Number, required: true },
      name: { type: String, required: true },
      dueDate: { type: Date, required: true },
      amountPaise: { type: Number, required: true, min: 0 },
      paidPaise: { type: Number, required: true, default: 0, min: 0 },
      status: { type: String, enum: INSTALLMENT_STATUSES, default: "pending", required: true },
      lastReminderOn: Date
    },
    baseOptions
  )
);
installmentSchema.index({ companyId: 1, bookingId: 1, sequence: 1 }, { unique: true });
installmentSchema.index({ companyId: 1, status: 1, dueDate: 1 });
installmentSchema.index({ companyId: 1, projectId: 1, dueDate: 1 });
installmentSchema.path("paidPaise").validate(function(v) {
  return v <= this.amountPaise;
}, "Installment cannot be over-allocated");
var Installment = model11("Installment", installmentSchema);

// src/modules/payments/payment.models.ts
import { model as model12, Schema as Schema13 } from "mongoose";
var paymentSchema = withTenant(
  new Schema13(
    {
      companyId: tenantRef,
      projectId: { type: Schema13.Types.ObjectId, ref: "Project", required: true, immutable: true },
      bookingId: { type: Schema13.Types.ObjectId, ref: "Booking", required: true, immutable: true },
      customerId: { type: Schema13.Types.ObjectId, ref: "Customer", required: true, immutable: true },
      kind: { type: String, enum: PAYMENT_KINDS, required: true, immutable: true },
      /** Receipt number (receipts) or voucher number (refunds). Unique per company. */
      number: { type: String, required: true, immutable: true },
      amountPaise: { type: Number, required: true, min: 1, immutable: true },
      allocatedPaise: { type: Number, default: 0, min: 0 },
      /** Part of a receipt held as customer advance because it exceeded the outstanding dues. */
      advancePaise: { type: Number, default: 0, min: 0 },
      mode: { type: String, enum: PAYMENT_MODES, required: true },
      reference: String,
      bankName: String,
      date: { type: Date, required: true },
      accountId: { type: Schema13.Types.ObjectId, ref: "Account", required: true },
      status: { type: String, enum: PAYMENT_STATUSES, default: "received", required: true },
      journalEntryId: { type: Schema13.Types.ObjectId, ref: "JournalEntry" },
      reversal: {
        reason: String,
        at: Date,
        by: { type: Schema13.Types.ObjectId, ref: "User" },
        journalEntryId: { type: Schema13.Types.ObjectId, ref: "JournalEntry" }
      },
      remarks: String,
      createdBy: { type: Schema13.Types.ObjectId, ref: "User", required: true }
    },
    baseOptions
  )
);
paymentSchema.index({ companyId: 1, number: 1 }, { unique: true });
paymentSchema.index({ companyId: 1, bookingId: 1, createdAt: 1 });
paymentSchema.index({ companyId: 1, projectId: 1, date: -1 });
paymentSchema.index({ companyId: 1, customerId: 1 });
var Payment = model12("Payment", paymentSchema);
var allocationSchema = withTenant(
  new Schema13(
    {
      companyId: tenantRef,
      paymentId: { type: Schema13.Types.ObjectId, ref: "Payment", required: true },
      installmentId: { type: Schema13.Types.ObjectId, ref: "Installment", required: true },
      bookingId: { type: Schema13.Types.ObjectId, ref: "Booking", required: true },
      amountPaise: { type: Number, required: true, min: 1 },
      reversedAt: Date
    },
    baseOptions
  )
);
allocationSchema.index({ companyId: 1, paymentId: 1 });
allocationSchema.index({ companyId: 1, installmentId: 1 });
var PaymentAllocation = model12("PaymentAllocation", allocationSchema);

// src/modules/accounting/accounting.models.ts
import { model as model13, Schema as Schema14 } from "mongoose";
var accountSchema2 = withTenant(
  new Schema14(
    {
      companyId: tenantRef,
      code: { type: String, required: true, trim: true },
      name: { type: String, required: true, trim: true },
      type: { type: String, enum: ACCOUNT_TYPES, required: true, immutable: true },
      parentId: { type: Schema14.Types.ObjectId, ref: "Account" },
      systemKey: String,
      isBank: { type: Boolean, default: false },
      /** Bank / cash account details (Administration → Bank & Cash Accounts). */
      cashBankKind: { type: String, enum: ["bank", "cash"] },
      bankDetails: {
        bankName: String,
        accountNumber: String,
        ifsc: String,
        branch: String,
        accountType: String,
        isReraAccount: Boolean
      },
      isActive: { type: Boolean, default: true },
      description: String
    },
    baseOptions
  )
);
accountSchema2.index({ companyId: 1, code: 1 }, { unique: true });
accountSchema2.index({ companyId: 1, systemKey: 1 }, { unique: true, partialFilterExpression: { systemKey: { $type: "string" } } });
var Account = model13("Account", accountSchema2);
var lineSchema = new Schema14(
  {
    accountId: { type: Schema14.Types.ObjectId, ref: "Account", required: true },
    debitPaise: { type: Number, required: true, min: 0, default: 0 },
    creditPaise: { type: Number, required: true, min: 0, default: 0 },
    narration: String,
    /** Party tagging lets customer ledgers be derived straight from the books. */
    customerId: { type: Schema14.Types.ObjectId, ref: "Customer" },
    bookingId: { type: Schema14.Types.ObjectId, ref: "Booking" },
    vendorId: { type: Schema14.Types.ObjectId, ref: "Vendor" },
    brokerId: { type: Schema14.Types.ObjectId, ref: "Broker" }
  },
  { _id: false }
);
var journalSchema = withTenant(
  new Schema14(
    {
      companyId: tenantRef,
      projectId: { type: Schema14.Types.ObjectId, ref: "Project" },
      entryNumber: { type: String, required: true, immutable: true },
      voucherType: { type: String, enum: VOUCHER_TYPES, required: true, immutable: true },
      date: { type: Date, required: true, immutable: true },
      narration: { type: String, required: true, immutable: true },
      reference: { type: String, immutable: true },
      lines: { type: [lineSchema], required: true, immutable: true },
      totalPaise: { type: Number, required: true, immutable: true },
      source: {
        type: { type: String },
        id: { type: Schema14.Types.ObjectId }
      },
      status: { type: String, enum: ["posted"], default: "posted", immutable: true },
      reversalOf: { type: Schema14.Types.ObjectId, ref: "JournalEntry", immutable: true },
      /** The only field that may change after posting: set once when a reversal is posted. */
      reversedBy: { type: Schema14.Types.ObjectId, ref: "JournalEntry" },
      reversalReason: String,
      postedBy: { type: Schema14.Types.ObjectId, ref: "User" }
    },
    baseOptions
  )
);
journalSchema.index({ companyId: 1, entryNumber: 1 }, { unique: true });
journalSchema.index({ companyId: 1, date: -1 });
journalSchema.index({ companyId: 1, "lines.accountId": 1, date: 1 });
journalSchema.index({ companyId: 1, "lines.customerId": 1, date: 1 });
journalSchema.index({ companyId: 1, "lines.vendorId": 1, date: 1 }, { sparse: true });
journalSchema.index({ companyId: 1, "lines.brokerId": 1, date: 1 }, { sparse: true });
journalSchema.index({ companyId: 1, "source.type": 1, "source.id": 1 });
var ALLOWED_UPDATE_KEYS = /* @__PURE__ */ new Set(["reversedBy", "reversalReason", "updatedAt"]);
function guardUpdate() {
  const update = this.getUpdate() ?? {};
  for (const [op, value] of Object.entries(update)) {
    if (op === "$setOnInsert" && value && Object.keys(value).every((k) => k === "createdAt")) continue;
    if (op !== "$set" || typeof value !== "object" || value === null) {
      throw new Error("Posted journal entries cannot be modified; post a reversal instead");
    }
    for (const key of Object.keys(value)) {
      if (!ALLOWED_UPDATE_KEYS.has(key)) throw new Error("Posted journal entries cannot be modified; post a reversal instead");
    }
  }
}
journalSchema.pre("updateOne", guardUpdate);
journalSchema.pre("findOneAndUpdate", guardUpdate);
journalSchema.pre("updateMany", function() {
  throw new Error("Bulk updates of journal entries are not allowed");
});
journalSchema.pre(["deleteOne", "deleteMany", "findOneAndDelete"], function() {
  throw new Error("Journal entries cannot be deleted; post a reversal instead");
});
journalSchema.pre("validate", function() {
  const debit = this.lines.reduce((s, l) => s + l.debitPaise, 0);
  const credit = this.lines.reduce((s, l) => s + l.creditPaise, 0);
  if (debit !== credit || debit <= 0) throw new Error("Journal entry does not balance");
  if (this.lines.some((l) => l.debitPaise > 0 === l.creditPaise > 0)) throw new Error("Each line needs either a debit or a credit");
});
var JournalEntry = model13("JournalEntry", journalSchema);

// src/modules/construction/construction.models.ts
import { model as model14, Schema as Schema15 } from "mongoose";
var vendorSchema2 = withTenant(
  new Schema15(
    {
      companyId: tenantRef,
      name: { type: String, required: true, trim: true },
      category: { type: String, enum: VENDOR_CATEGORIES, default: "other" },
      phone: String,
      email: String,
      gstin: String,
      pan: String,
      address: addressDef,
      isActive: { type: Boolean, default: true },
      createdBy: { type: Schema15.Types.ObjectId, ref: "User" }
    },
    baseOptions
  )
);
vendorSchema2.index({ companyId: 1, name: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });
var Vendor = model14("Vendor", vendorSchema2);
var milestoneDef = new Schema15(
  {
    name: { type: String, required: true },
    percentBp: Number,
    dueDate: Date,
    completedAt: Date
  },
  { _id: true }
);
var workOrderSchema2 = withTenant(
  new Schema15(
    {
      companyId: tenantRef,
      projectId: { type: Schema15.Types.ObjectId, ref: "Project", required: true, immutable: true },
      vendorId: { type: Schema15.Types.ObjectId, ref: "Vendor", required: true, immutable: true },
      number: { type: String, required: true, immutable: true },
      title: { type: String, required: true },
      scope: String,
      amountPaise: { type: Number, required: true, min: 1 },
      /** Sum of posted (non-reversed) bills against this order; never exceeds amountPaise. */
      billedPaise: { type: Number, default: 0, min: 0 },
      status: { type: String, enum: WORK_ORDER_STATUSES, default: "draft", required: true },
      milestones: { type: [milestoneDef], default: [] },
      startDate: Date,
      endDate: Date,
      createdBy: { type: Schema15.Types.ObjectId, ref: "User" }
    },
    baseOptions
  )
);
workOrderSchema2.index({ companyId: 1, number: 1 }, { unique: true });
workOrderSchema2.index({ companyId: 1, projectId: 1, status: 1 });
workOrderSchema2.index({ companyId: 1, vendorId: 1 });
var WorkOrder = model14("WorkOrder", workOrderSchema2);
var expenseSchema2 = withTenant(
  new Schema15(
    {
      companyId: tenantRef,
      number: { type: String, required: true, immutable: true },
      projectId: { type: Schema15.Types.ObjectId, ref: "Project" },
      vendorId: { type: Schema15.Types.ObjectId, ref: "Vendor" },
      workOrderId: { type: Schema15.Types.ObjectId, ref: "WorkOrder" },
      expenseAccountId: { type: Schema15.Types.ObjectId, ref: "Account", required: true },
      date: { type: Date, required: true },
      amountPaise: { type: Number, required: true, min: 1, immutable: true },
      description: { type: String, required: true },
      billNumber: String,
      settlement: { type: String, enum: EXPENSE_SETTLEMENTS, required: true },
      mode: { type: String, enum: PAYMENT_MODES },
      paidFromAccountId: { type: Schema15.Types.ObjectId, ref: "Account" },
      status: { type: String, enum: ["posted", "reversed"], default: "posted", required: true },
      journalEntryId: { type: Schema15.Types.ObjectId, ref: "JournalEntry" },
      reversal: { reason: String, at: Date, by: { type: Schema15.Types.ObjectId, ref: "User" }, journalEntryId: Schema15.Types.ObjectId },
      createdBy: { type: Schema15.Types.ObjectId, ref: "User" }
    },
    baseOptions
  )
);
expenseSchema2.index({ companyId: 1, number: 1 }, { unique: true });
expenseSchema2.index({ companyId: 1, projectId: 1, date: -1 });
expenseSchema2.index({ companyId: 1, vendorId: 1, date: -1 });
expenseSchema2.index({ companyId: 1, workOrderId: 1 });
var Expense = model14("Expense", expenseSchema2);
var vendorPaymentSchema2 = withTenant(
  new Schema15(
    {
      companyId: tenantRef,
      number: { type: String, required: true, immutable: true },
      vendorId: { type: Schema15.Types.ObjectId, ref: "Vendor", required: true },
      projectId: { type: Schema15.Types.ObjectId, ref: "Project" },
      amountPaise: { type: Number, required: true, min: 1, immutable: true },
      date: { type: Date, required: true },
      mode: { type: String, enum: PAYMENT_MODES, required: true },
      accountId: { type: Schema15.Types.ObjectId, ref: "Account", required: true },
      reference: String,
      remarks: String,
      journalEntryId: { type: Schema15.Types.ObjectId, ref: "JournalEntry" },
      createdBy: { type: Schema15.Types.ObjectId, ref: "User" }
    },
    baseOptions
  )
);
vendorPaymentSchema2.index({ companyId: 1, number: 1 }, { unique: true });
vendorPaymentSchema2.index({ companyId: 1, vendorId: 1, date: -1 });
var VendorPayment = model14("VendorPayment", vendorPaymentSchema2);

// src/modules/documents/document.model.ts
import { model as model15, Schema as Schema16 } from "mongoose";
var documentSchema = withTenant(
  new Schema16(
    {
      companyId: tenantRef,
      projectId: { type: Schema16.Types.ObjectId, ref: "Project" },
      entityType: { type: String, enum: DOCUMENT_ENTITY_TYPES, required: true },
      entityId: { type: Schema16.Types.ObjectId, required: true },
      category: { type: String, enum: DOCUMENT_CATEGORIES, default: "general" },
      description: String,
      fileName: { type: String, required: true },
      mimeType: { type: String, required: true },
      sizeBytes: { type: Number, required: true, min: 1 },
      storageKey: { type: String, required: true, select: false },
      checksumSha256: String,
      uploadedBy: { type: Schema16.Types.ObjectId, ref: "User", required: true },
      deletedAt: Date,
      deletedBy: { type: Schema16.Types.ObjectId, ref: "User" }
    },
    baseOptions
  )
);
documentSchema.index({ companyId: 1, entityType: 1, entityId: 1, createdAt: -1 });
var DocumentFile = model15("Document", documentSchema);

// src/modules/notifications/notification.model.ts
import { model as model16, Schema as Schema17 } from "mongoose";
var notificationSchema = withTenant(
  new Schema17(
    {
      companyId: tenantRef,
      userId: { type: Schema17.Types.ObjectId, ref: "User", required: true },
      type: { type: String, required: true },
      title: { type: String, required: true },
      body: String,
      link: String,
      readAt: Date,
      /** Prevents duplicate reminders, e.g. "installment-due:<id>:<date>". */
      dedupeKey: String
    },
    baseOptions
  )
);
notificationSchema.index({ companyId: 1, userId: 1, readAt: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 3600 });
var Notification = model16("Notification", notificationSchema);

// src/modules/audit/audit.model.ts
import { model as model17, Schema as Schema18 } from "mongoose";
var auditSchema = new Schema18(
  {
    companyId: { type: Schema18.Types.ObjectId, ref: "Company" },
    actorId: { type: Schema18.Types.ObjectId, ref: "User" },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: Schema18.Types.ObjectId },
    summary: String,
    changes: Schema18.Types.Mixed,
    ip: String,
    userAgent: String,
    requestId: String
  },
  { ...baseOptions, timestamps: { createdAt: true, updatedAt: false } }
);
auditSchema.index({ companyId: 1, createdAt: -1 });
auditSchema.index({ companyId: 1, entityType: 1, entityId: 1, createdAt: -1 });
auditSchema.index({ companyId: 1, actorId: 1, createdAt: -1 });
auditSchema.pre(["updateOne", "updateMany", "findOneAndUpdate", "deleteOne", "deleteMany", "findOneAndDelete"], function() {
  throw new Error("Audit logs are immutable");
});
var AuditLog = model17("AuditLog", auditSchema);

// src/modules/brokers/commission.model.ts
import { model as model18, Schema as Schema19 } from "mongoose";
var commissionSchema = withTenant(
  new Schema19(
    {
      companyId: tenantRef,
      brokerId: { type: Schema19.Types.ObjectId, ref: "Broker", required: true },
      bookingId: { type: Schema19.Types.ObjectId, ref: "Booking", required: true },
      projectId: { type: Schema19.Types.ObjectId, ref: "Project", required: true },
      basePaise: { type: Number, required: true, min: 0 },
      rateBp: { type: Number, required: true, min: 0, max: 1e4 },
      amountPaise: { type: Number, required: true, min: 1 },
      status: { type: String, enum: COMMISSION_STATUSES, default: "accrued", required: true },
      accrualJournalEntryId: { type: Schema19.Types.ObjectId, ref: "JournalEntry" },
      cancelJournalEntryId: { type: Schema19.Types.ObjectId, ref: "JournalEntry" },
      payout: {
        number: String,
        paidOn: Date,
        mode: { type: String, enum: PAYMENT_MODES },
        accountId: { type: Schema19.Types.ObjectId, ref: "Account" },
        reference: String,
        journalEntryId: { type: Schema19.Types.ObjectId, ref: "JournalEntry" }
      }
    },
    baseOptions
  )
);
commissionSchema.index({ companyId: 1, bookingId: 1 }, { unique: true });
commissionSchema.index({ companyId: 1, brokerId: 1, status: 1 });
var BrokerCommission = model18("BrokerCommission", commissionSchema);

// src/modules/masters/masters.models.ts
import { model as model19, Schema as Schema20 } from "mongoose";
var ref = (to) => ({ type: Schema20.Types.ObjectId, ref: to });
var partySchema2 = withTenant(
  new Schema20(
    {
      companyId: tenantRef,
      kind: { type: String, enum: PARTY_KINDS, required: true },
      name: { type: String, required: true, trim: true },
      phone: String,
      email: String,
      pan: String,
      shareBp: Number,
      contributionPaise: Number,
      bankName: String,
      accountNumber: String,
      ifsc: String,
      address: addressDef,
      landParcelIds: [ref("LandParcel")],
      projectIds: [ref("Project")],
      notes: String,
      isActive: { type: Boolean, default: true },
      deletedAt: Date,
      createdBy: ref("User")
    },
    baseOptions
  )
);
partySchema2.index({ companyId: 1, kind: 1, name: 1 });
var Party = model19("Party", partySchema2);
var financerSchema2 = withTenant(
  new Schema20(
    {
      companyId: tenantRef,
      name: { type: String, required: true, trim: true },
      type: { type: String, enum: FINANCER_TYPES, required: true },
      branch: String,
      contactPerson: String,
      phone: String,
      email: String,
      approvedProjectIds: [ref("Project")],
      interestRateBp: Number,
      notes: String,
      isActive: { type: Boolean, default: true },
      deletedAt: Date,
      createdBy: ref("User")
    },
    baseOptions
  )
);
financerSchema2.index({ companyId: 1, name: 1, branch: 1 });
var Financer = model19("Financer", financerSchema2);
var consultantSchema2 = withTenant(
  new Schema20(
    {
      companyId: tenantRef,
      name: { type: String, required: true, trim: true },
      type: { type: String, enum: CONSULTANT_TYPES, required: true },
      firm: String,
      phone: String,
      email: String,
      registrationNo: String,
      feeNote: String,
      address: addressDef,
      isActive: { type: Boolean, default: true },
      deletedAt: Date,
      createdBy: ref("User")
    },
    baseOptions
  )
);
consultantSchema2.index({ companyId: 1, type: 1, name: 1 });
var Consultant = model19("Consultant", consultantSchema2);
var chargeMasterSchema2 = withTenant(
  new Schema20(
    {
      companyId: tenantRef,
      projectId: { ...ref("Project"), default: null },
      name: { type: String, required: true, trim: true },
      kind: { type: String, enum: CHARGE_KINDS, required: true },
      basis: { type: String, enum: CHARGE_BASES, required: true },
      value: { type: Number, required: true, min: 0 },
      gstBp: { type: Number, default: 0 },
      isMandatory: { type: Boolean, default: false },
      isActive: { type: Boolean, default: true },
      deletedAt: Date,
      createdBy: ref("User")
    },
    baseOptions
  )
);
chargeMasterSchema2.index({ companyId: 1, projectId: 1, name: 1 });
var ChargeMaster = model19("ChargeMaster", chargeMasterSchema2);
var rateIndexSchema2 = withTenant(
  new Schema20(
    {
      companyId: tenantRef,
      projectId: { ...ref("Project"), required: true },
      phaseId: ref("ProjectPhase"),
      blockId: ref("Block"),
      unitType: { type: String, enum: UNIT_TYPES },
      category: { type: String, enum: PLOT_CATEGORIES },
      name: { type: String, required: true, trim: true },
      ratePaisePerSqft: { type: Number, required: true, min: 1 },
      plcBp: Number,
      effectiveFrom: { type: Date, required: true },
      notes: String,
      applications: [
        {
          _id: false,
          at: { type: Date, default: Date.now },
          by: ref("User"),
          unitsRepriced: Number
        }
      ],
      deletedAt: Date,
      createdBy: ref("User")
    },
    baseOptions
  )
);
rateIndexSchema2.index({ companyId: 1, projectId: 1, effectiveFrom: -1 });
var RateIndex = model19("RateIndex", rateIndexSchema2);
var parkingSlotSchema2 = withTenant(
  new Schema20(
    {
      companyId: tenantRef,
      projectId: { ...ref("Project"), required: true, immutable: true },
      blockId: ref("Block"),
      code: { type: String, required: true, uppercase: true, trim: true },
      type: { type: String, enum: PARKING_TYPES, required: true },
      level: String,
      pricePaise: { type: Number, default: 0, min: 0 },
      status: { type: String, enum: PARKING_STATUSES, default: "available", required: true },
      bookingId: { ...ref("Booking"), default: null },
      customerId: ref("Customer"),
      allottedAt: Date,
      remarks: String,
      history: [
        {
          _id: false,
          action: String,
          bookingId: ref("Booking"),
          note: String,
          at: { type: Date, default: Date.now },
          by: ref("User")
        }
      ]
    },
    baseOptions
  )
);
parkingSlotSchema2.index({ companyId: 1, projectId: 1, code: 1 }, { unique: true });
parkingSlotSchema2.index({ companyId: 1, projectId: 1, status: 1 });
parkingSlotSchema2.index({ companyId: 1, bookingId: 1 }, { sparse: true });
var ParkingSlot = model19("ParkingSlot", parkingSlotSchema2);

// src/modules/presales/presales.models.ts
import { model as model20, Schema as Schema21 } from "mongoose";
var ref2 = (to) => ({ type: Schema21.Types.ObjectId, ref: to });
var whatsappTemplateSchema2 = withTenant(
  new Schema21(
    {
      companyId: tenantRef,
      name: { type: String, required: true, trim: true },
      category: { type: String, enum: WHATSAPP_TEMPLATE_CATEGORIES, required: true },
      body: { type: String, required: true },
      isActive: { type: Boolean, default: true },
      timesUsed: { type: Number, default: 0 },
      deletedAt: Date,
      createdBy: ref2("User")
    },
    baseOptions
  )
);
whatsappTemplateSchema2.index({ companyId: 1, category: 1, name: 1 });
var WhatsappTemplate = model20("WhatsappTemplate", whatsappTemplateSchema2);
var portalIntegrationSchema2 = withTenant(
  new Schema21(
    {
      companyId: tenantRef,
      portal: { type: String, enum: PORTALS, required: true },
      name: { type: String, required: true, trim: true },
      projectId: ref2("Project"),
      defaultAssigneeId: ref2("User"),
      /** Random secret in the webhook URL (a capability URL, like a webhook signing secret). Rotatable. */
      token: { type: String, required: true },
      isActive: { type: Boolean, default: true },
      leadsReceived: { type: Number, default: 0 },
      duplicates: { type: Number, default: 0 },
      lastReceivedAt: Date,
      deletedAt: Date,
      createdBy: ref2("User")
    },
    baseOptions
  )
);
portalIntegrationSchema2.index({ token: 1 }, { unique: true });
portalIntegrationSchema2.index({ companyId: 1, portal: 1 });
var PortalIntegration = model20("PortalIntegration", portalIntegrationSchema2);
var inboundLogSchema = withTenant(
  new Schema21(
    {
      companyId: tenantRef,
      integrationId: { ...ref2("PortalIntegration"), required: true },
      outcome: { type: String, enum: ["created", "duplicate", "rejected"], required: true },
      leadId: ref2("Lead"),
      name: String,
      phone: String,
      error: String,
      /** Truncated copy of what the portal sent, for troubleshooting field mappings. */
      payload: String,
      ip: String
    },
    { ...baseOptions, timestamps: { createdAt: true, updatedAt: false } }
  )
);
inboundLogSchema.index({ companyId: 1, integrationId: 1, createdAt: -1 });
inboundLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });
var InboundLog = model20("InboundLog", inboundLogSchema);
var quotationSchema2 = withTenant(
  new Schema21(
    {
      companyId: tenantRef,
      projectId: { ...ref2("Project"), required: true },
      number: { type: String, required: true, immutable: true },
      leadId: ref2("Lead"),
      customerId: ref2("Customer"),
      prospectName: String,
      prospectPhone: String,
      quoteDate: { type: Date, required: true },
      validUntil: { type: Date, required: true },
      paymentPlanId: { ...ref2("PaymentPlan"), required: true },
      planName: String,
      plotIds: [ref2("Plot")],
      items: { type: [Schema21.Types.Mixed], default: [] },
      grossAmountPaise: { type: Number, required: true },
      discountPaise: { type: Number, default: 0 },
      charges: [{ _id: false, name: String, amountPaise: Number }],
      chargesTotalPaise: { type: Number, default: 0 },
      netAmountPaise: { type: Number, required: true },
      schedule: { type: [Schema21.Types.Mixed], default: [] },
      status: { type: String, enum: QUOTATION_STATUSES, default: "draft", required: true },
      bookingId: ref2("Booking"),
      notes: String,
      createdBy: ref2("User")
    },
    baseOptions
  )
);
quotationSchema2.index({ companyId: 1, number: 1 }, { unique: true });
quotationSchema2.index({ companyId: 1, projectId: 1, status: 1, createdAt: -1 });
quotationSchema2.index({ companyId: 1, leadId: 1 }, { sparse: true });
var Quotation = model20("Quotation", quotationSchema2);

// src/modules/postsales/postsales.models.ts
import { model as model21, Schema as Schema22 } from "mongoose";
var ref3 = (to) => ({ type: Schema22.Types.ObjectId, ref: to });
var salesDocumentSchema = withTenant(
  new Schema22(
    {
      companyId: tenantRef,
      kind: { type: String, enum: SALES_DOC_KINDS, required: true, immutable: true },
      number: { type: String, required: true, immutable: true },
      projectId: { ...ref3("Project"), required: true },
      bookingId: { ...ref3("Booking"), required: true },
      customerId: { ...ref3("Customer"), required: true },
      date: { type: Date, required: true },
      status: { type: String, required: true },
      details: { type: Schema22.Types.Mixed, default: {} },
      /** Demand letters: amount demanded. Registry: stamp duty + fees. */
      amountPaise: { type: Number, default: 0 },
      outstandingAtCreationPaise: Number,
      duesOverridden: Boolean,
      remarks: String,
      history: [{ _id: false, status: String, note: String, at: { type: Date, default: Date.now }, by: ref3("User") }],
      createdBy: ref3("User")
    },
    // Keep empty `details` objects instead of dropping the field.
    { ...baseOptions, minimize: false }
  )
);
salesDocumentSchema.index({ companyId: 1, number: 1 }, { unique: true });
salesDocumentSchema.index({ companyId: 1, kind: 1, projectId: 1, date: -1 });
salesDocumentSchema.index({ companyId: 1, bookingId: 1, kind: 1 });
var SalesDocument = model21("SalesDocument", salesDocumentSchema);
var followUpSchema2 = withTenant(
  new Schema22(
    {
      companyId: tenantRef,
      projectId: { ...ref3("Project"), required: true },
      bookingId: { ...ref3("Booking"), required: true },
      customerId: { ...ref3("Customer"), required: true },
      type: { type: String, enum: FOLLOWUP_TYPES, required: true },
      note: { type: String, required: true },
      promisedAmountPaise: Number,
      promisedOn: Date,
      nextFollowUpOn: Date,
      createdBy: ref3("User")
    },
    { ...baseOptions, timestamps: { createdAt: true, updatedAt: false } }
  )
);
followUpSchema2.index({ companyId: 1, bookingId: 1, createdAt: -1 });
followUpSchema2.index({ companyId: 1, nextFollowUpOn: 1 });
var CollectionFollowUp = model21("CollectionFollowUp", followUpSchema2);

// src/modules/finance/finance.models.ts
import { model as model22, Schema as Schema23 } from "mongoose";
var ref4 = (to) => ({ type: Schema23.Types.ObjectId, ref: to });
var pdcSchema2 = withTenant(
  new Schema23(
    {
      companyId: tenantRef,
      projectId: { ...ref4("Project"), required: true },
      bookingId: { ...ref4("Booking"), required: true },
      customerId: { ...ref4("Customer"), required: true },
      chequeNumber: { type: String, required: true },
      bankName: { type: String, required: true },
      branch: String,
      chequeDate: { type: Date, required: true },
      amountPaise: { type: Number, required: true, min: 1 },
      status: { type: String, enum: PDC_STATUSES, default: "received", required: true },
      depositedOn: Date,
      depositAccountId: ref4("Account"),
      clearedOn: Date,
      paymentId: ref4("Payment"),
      bouncedOn: Date,
      bounceReason: String,
      remarks: String,
      history: [{ _id: false, status: String, note: String, at: { type: Date, default: Date.now }, by: ref4("User") }],
      createdBy: ref4("User")
    },
    baseOptions
  )
);
pdcSchema2.index({ companyId: 1, bookingId: 1, chequeNumber: 1, bankName: 1 }, { unique: true });
pdcSchema2.index({ companyId: 1, status: 1, chequeDate: 1 });
var Pdc = model22("Pdc", pdcSchema2);
var ledgerAdjustmentSchema2 = withTenant(
  new Schema23(
    {
      companyId: tenantRef,
      number: { type: String, required: true, immutable: true },
      projectId: { ...ref4("Project"), required: true },
      bookingId: { ...ref4("Booking"), required: true },
      customerId: { ...ref4("Customer"), required: true },
      type: { type: String, enum: ADJUSTMENT_TYPES, required: true, immutable: true },
      reason: { type: String, enum: ADJUSTMENT_REASONS, required: true },
      amountPaise: { type: Number, required: true, min: 1, immutable: true },
      date: { type: Date, required: true },
      accountId: { ...ref4("Account"), required: true },
      narration: String,
      /** Installment changes made by this adjustment, so a reversal can undo them exactly. */
      effects: [{ _id: false, installmentId: ref4("Installment"), deltaPaise: Number, created: Boolean }],
      journalEntryId: ref4("JournalEntry"),
      status: { type: String, enum: ["posted", "reversed"], default: "posted" },
      reversal: { at: Date, by: ref4("User"), reason: String, journalEntryId: ref4("JournalEntry") },
      createdBy: ref4("User")
    },
    baseOptions
  )
);
ledgerAdjustmentSchema2.index({ companyId: 1, number: 1 }, { unique: true });
ledgerAdjustmentSchema2.index({ companyId: 1, bookingId: 1, status: 1 });
var LedgerAdjustment = model22("LedgerAdjustment", ledgerAdjustmentSchema2);
var gstVoucherSchema2 = withTenant(
  new Schema23(
    {
      companyId: tenantRef,
      number: { type: String, required: true, immutable: true },
      direction: { type: String, enum: GST_DIRECTIONS, required: true, immutable: true },
      date: { type: Date, required: true },
      invoiceNumber: { type: String, required: true },
      partyName: { type: String, required: true },
      partyGstin: String,
      placeOfSupply: String,
      interState: { type: Boolean, default: false },
      hsnSac: String,
      description: String,
      taxableValuePaise: { type: Number, required: true },
      rateBp: { type: Number, required: true },
      cgstPaise: { type: Number, default: 0 },
      sgstPaise: { type: Number, default: 0 },
      igstPaise: { type: Number, default: 0 },
      totalPaise: { type: Number, required: true },
      accountId: { ...ref4("Account"), required: true },
      settlementAccountId: ref4("Account"),
      vendorId: ref4("Vendor"),
      projectId: ref4("Project"),
      journalEntryId: ref4("JournalEntry"),
      status: { type: String, enum: ["posted", "reversed"], default: "posted" },
      reversal: { at: Date, by: ref4("User"), reason: String, journalEntryId: ref4("JournalEntry") },
      createdBy: ref4("User")
    },
    baseOptions
  )
);
gstVoucherSchema2.index({ companyId: 1, number: 1 }, { unique: true });
gstVoucherSchema2.index({ companyId: 1, direction: 1, date: -1 });
var GstVoucher = model22("GstVoucher", gstVoucherSchema2);

// src/middleware/auth.ts
import { Types } from "mongoose";

// src/modules/auth/tokens.ts
import jwt from "jsonwebtoken";

// src/utils/errors.ts
var AppError = class extends Error {
  constructor(status, code2, message, details) {
    super(message);
    this.status = status;
    this.code = code2;
    this.details = details;
    this.name = "AppError";
  }
  status;
  code;
  details;
};
var badRequest = (message, details) => new AppError(400, "VALIDATION_ERROR", message, details);
var unauthenticated = (message = "Authentication required") => new AppError(401, "UNAUTHENTICATED", message);
var forbidden = (message = "You do not have permission to perform this action") => new AppError(403, "FORBIDDEN", message);
var notFound = (entity = "Resource") => new AppError(404, "NOT_FOUND", `${entity} not found`);
var conflict = (message) => new AppError(409, "CONFLICT", message);
var businessRule = (message) => new AppError(422, "BUSINESS_RULE", message);

// src/modules/auth/tokens.ts
var ISSUER = "real-estate-erp-api";
var AUDIENCE = "real-estate-erp-web";
function signAccessToken(userId, sessionId) {
  const token = jwt.sign({ sid: sessionId }, env.JWT_ACCESS_SECRET, {
    algorithm: "HS256",
    subject: userId,
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS
  });
  return { token, expiresAt: new Date(Date.now() + env.ACCESS_TOKEN_TTL_SECONDS * 1e3) };
}
function verifyAccessToken(token) {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE
    });
    if (typeof payload.sub !== "string" || typeof payload.sid !== "string") throw new Error("bad payload");
    return { sub: payload.sub, sid: payload.sid };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) throw new AppError(401, "TOKEN_EXPIRED", "Access token expired");
    throw new AppError(401, "UNAUTHENTICATED", "Invalid access token");
  }
}

// src/middleware/auth.ts
async function authenticate(req, _res, next) {
  const header2 = req.headers.authorization;
  if (!header2?.startsWith("Bearer ")) throw unauthenticated();
  const payload = verifyAccessToken(header2.slice(7));
  const session = await Session.findById(payload.sid).select("userId revokedAt expiresAt activeCompanyId").lean();
  if (!session || session.revokedAt || session.expiresAt < /* @__PURE__ */ new Date() || String(session.userId) !== payload.sub) {
    throw new AppError(401, "UNAUTHENTICATED", "Session has ended. Please sign in again.");
  }
  const user = await User.findById(payload.sub).select("isActive").lean();
  if (!user?.isActive) throw unauthenticated("Account is disabled");
  req.auth = {
    userId: payload.sub,
    sessionId: payload.sid,
    companyId: session.activeCompanyId ? String(session.activeCompanyId) : void 0
  };
  next();
}
async function tenant(req, _res, next) {
  if (!req.auth) throw unauthenticated();
  if (!req.auth.companyId) throw new AppError(403, "FORBIDDEN", "Select a company to continue");
  const companyId = new Types.ObjectId(req.auth.companyId);
  const userId = new Types.ObjectId(req.auth.userId);
  const membership = await Membership.findOne({ companyId, userId, status: "active" }).lean();
  if (!membership) throw forbidden("You are not an active member of this company");
  const role = await Role.findOne({ companyId, _id: membership.roleId }).select("permissions systemKey").lean();
  if (!role) throw forbidden("Your role no longer exists");
  req.ctx = {
    userId,
    companyId,
    roleId: role._id,
    // The owner role always carries the full, current catalog (including newly added permissions).
    permissions: new Set(role.systemKey === "owner" ? ALL_PERMISSIONS : role.permissions),
    projectScope: membership.projectAccess?.mode === "restricted" ? membership.projectAccess.projectIds ?? [] : null,
    meta: { ip: req.ip, userAgent: req.get("user-agent"), requestId: String(req.id) }
  };
  next();
}
function authorize(...permissions) {
  return (req, _res, next) => {
    const ctx = req.ctx;
    if (!ctx) throw unauthenticated();
    for (const p of permissions) if (!ctx.permissions.has(p)) throw forbidden();
    next();
  };
}

// src/middleware/error.ts
import mongoose2 from "mongoose";
import { ZodError } from "zod";

// src/utils/logger.ts
import pino from "pino";
var level = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info");
var logger = pino({
  level,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'res.headers["set-cookie"]',
      "*.password",
      "*.passwordHash",
      "*.token",
      "*.refreshToken"
    ],
    censor: "[redacted]"
  },
  transport: process.env.NODE_ENV === "development" && process.stdout.isTTY ? { target: "pino-pretty", options: { colorize: true } } : void 0
});

// src/middleware/error.ts
function notFoundHandler(req, _res, next) {
  next(new AppError(404, "NOT_FOUND", `Route ${req.method} ${req.path} not found`));
}
function errorHandler(err, req, res, _next) {
  let status = 500;
  let body2 = { code: "INTERNAL", message: "Something went wrong. Please try again." };
  if (err instanceof AppError) {
    status = err.status;
    body2 = { code: err.code, message: err.message, details: err.details };
  } else if (err instanceof ZodError) {
    status = 400;
    body2 = {
      code: "VALIDATION_ERROR",
      message: "Please correct the highlighted fields",
      details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message }))
    };
  } else if (err instanceof ScheduleError) {
    status = 422;
    body2 = { code: "BUSINESS_RULE", message: err.message };
  } else if (err instanceof mongoose2.Error.CastError) {
    status = 400;
    body2 = { code: "VALIDATION_ERROR", message: `Invalid value for ${err.path}` };
  } else if (err instanceof mongoose2.Error.ValidationError) {
    status = 400;
    body2 = {
      code: "VALIDATION_ERROR",
      message: "Validation failed",
      details: Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }))
    };
  } else if (err?.code === 11e3) {
    status = 409;
    const fields = Object.keys(err.keyPattern ?? {}).filter((k) => k !== "companyId");
    body2 = { code: "CONFLICT", message: fields.length ? `A record with this ${fields.join(" / ")} already exists` : "Duplicate record" };
  } else if (err?.type === "entity.too.large") {
    status = 413;
    body2 = { code: "VALIDATION_ERROR", message: "Request body is too large" };
  } else if (err?.type === "entity.parse.failed") {
    status = 400;
    body2 = { code: "VALIDATION_ERROR", message: "Malformed JSON body" };
  }
  if (status >= 500) {
    logger.error({ err, requestId: req.id, path: req.path }, "Unhandled error");
  }
  body2.requestId = String(req.id);
  if (!env.isProd && status >= 500 && err instanceof Error) {
    body2.message = `${body2.message} (${err.message})`;
  }
  res.status(status).json({ success: false, error: body2 });
}

// src/middleware/security.ts
import { randomUUID } from "crypto";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

// src/utils/crypto.ts
import { createHash, randomBytes, timingSafeEqual } from "crypto";
function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

// src/middleware/security.ts
function requestId(req, res, next) {
  const incoming = req.get("x-request-id");
  req.id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader("x-request-id", req.id);
  next();
}
var rateLimitHandler = () => {
  throw new AppError(429, "RATE_LIMITED", "Too many requests. Please try again shortly.");
};
var apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1e3,
  limit: env.isTest ? 1e4 : 1e3,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: rateLimitHandler
});
var credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1e3,
  limit: env.LOGIN_RATE_LIMIT_PER_15_MIN,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? "")}:${String(req.body?.email ?? "").toLowerCase()}`,
  skip: () => env.isTest && process.env.ENABLE_RATE_LIMIT_TESTS !== "1",
  handler: rateLimitHandler
});
var CSRF_COOKIE = "erp_csrf";
var CSRF_HEADER = "x-csrf-token";
function requireCsrf(req, _res, next) {
  const cookie = req.cookies?.[CSRF_COOKIE];
  const header2 = req.get(CSRF_HEADER);
  if (!cookie || !header2 || !safeEqual(cookie, header2)) {
    throw new AppError(403, "CSRF", "Invalid or missing CSRF token");
  }
  next();
}

// src/modules/accounting/accounting.routes.ts
import { Router } from "express";

// src/middleware/validate.ts
function validate(schemas) {
  return (req, _res, next) => {
    req.validated = {
      body: schemas.body ? schemas.body.parse(req.body ?? {}) : void 0,
      query: schemas.query ? schemas.query.parse(req.query) : void 0,
      params: schemas.params ? schemas.params.parse(req.params) : void 0
    };
    next();
  };
}
function body(req) {
  return req.validated?.body;
}
function query(req) {
  return req.validated?.query;
}
function params(req) {
  return req.validated?.params;
}

// src/utils/http.ts
import { Types as Types2 } from "mongoose";
function serialize(value) {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Types2.ObjectId) return String(value);
  if (value instanceof Date || Buffer.isBuffer(value)) return value;
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value.toJSON === "function" && !(value.constructor === Object)) {
    return serialize(value.toJSON());
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === "__v" || k === "passwordHash" || k === "tokenHash" || k === "storageKey") continue;
    if (k === "_id") {
      if (!("id" in value)) out.id = serialize(v);
      continue;
    }
    out[k] = serialize(v);
  }
  return out;
}
function ok(res, data, meta2, status = 200) {
  const body2 = serialize(data);
  res.status(status).json(meta2 ? { success: true, data: body2, meta: meta2 } : { success: true, data: body2 });
}
function created(res, data) {
  ok(res, data, void 0, 201);
}
function pageMeta(page, pageSize, total) {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
function parseSort(sort, allowed, fallback) {
  if (!sort) return fallback;
  const desc = sort.startsWith("-");
  const field = desc ? sort.slice(1) : sort;
  if (!allowed.includes(field)) return fallback;
  return { [field]: desc ? -1 : 1, _id: desc ? -1 : 1 };
}
function escapeRegex(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// src/utils/tenant.ts
import { Types as Types3 } from "mongoose";
function getCtx(req) {
  if (!req.ctx) throw unauthenticated("Select a company first");
  return req.ctx;
}
function hasPermission(ctx, permission) {
  return ctx.permissions.has(permission);
}
function requirePermission(ctx, permission) {
  if (!ctx.permissions.has(permission)) throw forbidden();
}
function toObjectId(id) {
  if (id instanceof Types3.ObjectId) return id;
  if (!Types3.ObjectId.isValid(id) || String(new Types3.ObjectId(id)) !== id.toLowerCase()) throw notFound();
  return new Types3.ObjectId(id);
}
function canAccessProject(ctx, projectId) {
  if (ctx.projectScope === null) return true;
  const id = String(projectId);
  return ctx.projectScope.some((p) => String(p) === id);
}
function assertProjectAccess(ctx, projectId) {
  if (!canAccessProject(ctx, projectId)) throw notFound("Project");
}
function scopedFilter(ctx, projectId, field = "projectId") {
  const filter = { companyId: ctx.companyId };
  if (projectId) {
    assertProjectAccess(ctx, projectId);
    filter[field] = toObjectId(projectId);
  } else if (ctx.projectScope !== null) {
    filter[field] = { $in: ctx.projectScope };
  }
  return filter;
}

// src/db/transaction.ts
import mongoose3 from "mongoose";
async function withTransaction(fn) {
  const session = await mongoose3.startSession();
  try {
    let result;
    await session.withTransaction(
      async () => {
        result = await fn(session);
      },
      {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
        readPreference: "primary"
      }
    );
    return result;
  } finally {
    await session.endSession();
  }
}

// src/utils/audit.ts
async function audit(ctx, event, session) {
  await AuditLog.create(
    [
      {
        companyId: ctx?.companyId,
        actorId: ctx?.userId,
        ...event,
        ip: ctx?.meta.ip,
        userAgent: ctx?.meta.userAgent?.slice(0, 300),
        requestId: ctx?.meta.requestId
      }
    ],
    { session }
  );
}

// src/modules/accounting/ledger.service.ts
import { Types as Types4 } from "mongoose";
var CONTROL_ACCOUNT_KEYS = [
  "customer_receivable",
  "customer_advance",
  "refund_payable",
  "vendor_payable",
  "broker_payable"
];
var VOUCHER_PREFIX = {
  journal: "JV",
  receipt: "RV",
  payment: "PV",
  contra: "CV",
  sales: "SV",
  reversal: "RJ"
};
async function systemAccountId(companyId, key, session) {
  const acc = await Account.findOne({ companyId, systemKey: key }).session(session ?? null).select("_id").lean();
  if (acc) return acc._id;
  const def = SYSTEM_ACCOUNTS.find((a) => a.systemKey === key);
  if (!def) throw new Error(`Unknown system account ${key}`);
  const codeTaken = await Account.exists({ companyId, code: def.code }).session(session ?? null);
  const [created2] = await Account.create(
    [{ companyId, systemKey: def.systemKey, code: codeTaken ? `${def.code}-S` : def.code, name: def.name, type: def.type }],
    { session }
  );
  return created2._id;
}
async function postJournal(actor, input, session) {
  const lines = [];
  const accountIds = /* @__PURE__ */ new Set();
  for (const l of input.lines) {
    const debit2 = l.debitPaise ?? 0;
    const credit2 = l.creditPaise ?? 0;
    if (!Number.isSafeInteger(debit2) || !Number.isSafeInteger(credit2) || debit2 < 0 || credit2 < 0) {
      throw businessRule("Journal amounts must be non-negative whole paise");
    }
    if (debit2 === 0 && credit2 === 0) continue;
    const accountId = l.accountId ? new Types4.ObjectId(String(l.accountId)) : await systemAccountId(actor.companyId, l.systemKey, session);
    accountIds.add(String(accountId));
    lines.push({
      accountId,
      debitPaise: debit2,
      creditPaise: credit2,
      narration: l.narration,
      customerId: l.customerId,
      bookingId: l.bookingId,
      vendorId: l.vendorId,
      brokerId: l.brokerId
    });
  }
  const debit = lines.reduce((s, l) => s + l.debitPaise, 0);
  const credit = lines.reduce((s, l) => s + l.creditPaise, 0);
  if (lines.length < 2 || debit !== credit || debit === 0) {
    throw businessRule(`Journal entry does not balance (debit ${debit}, credit ${credit})`);
  }
  const accounts = await Account.find({ companyId: actor.companyId, _id: { $in: [...accountIds].map((id) => new Types4.ObjectId(id)) } }).session(session).select("isActive systemKey name").lean();
  if (accounts.length !== accountIds.size) throw businessRule("One or more accounts do not belong to this company");
  const inactive = accounts.find((a) => !a.isActive);
  if (inactive) throw businessRule(`Account "${inactive.name}" is inactive`);
  if (!input.allowControlAccounts) {
    const control = accounts.find((a) => a.systemKey && CONTROL_ACCOUNT_KEYS.includes(a.systemKey));
    if (control) throw businessRule(`"${control.name}" is a control account and can only be posted through bookings and payments`);
  }
  const fy = financialYear(input.date);
  const seq = await nextSequence(actor.companyId, `je:${fy}`, session);
  const entryNumber = `${VOUCHER_PREFIX[input.voucherType]}/${fy}/${String(seq).padStart(6, "0")}`;
  const [entry] = await JournalEntry.create(
    [
      {
        companyId: actor.companyId,
        projectId: input.projectId,
        entryNumber,
        voucherType: input.voucherType,
        date: parseISODate(input.date),
        narration: input.narration,
        reference: input.reference,
        lines,
        totalPaise: debit,
        source: input.source,
        reversalOf: input.reversalOf,
        postedBy: actor.userId
      }
    ],
    { session }
  );
  return entry;
}
async function reverseJournal(actor, entryId, reason, session, date) {
  const original = await JournalEntry.findOne({ companyId: actor.companyId, _id: entryId }).session(session).lean();
  if (!original) throw notFound("Journal entry");
  if (original.reversedBy) throw businessRule("This entry has already been reversed");
  if (original.reversalOf) throw businessRule("A reversal entry cannot itself be reversed");
  const reversal = await postJournal(
    actor,
    {
      date: date ?? toISODate(/* @__PURE__ */ new Date()),
      voucherType: "reversal",
      narration: `Reversal of ${original.entryNumber}: ${reason}`,
      reference: original.entryNumber,
      projectId: original.projectId ?? void 0,
      lines: original.lines.map((l) => ({
        accountId: l.accountId,
        debitPaise: l.creditPaise,
        creditPaise: l.debitPaise,
        narration: l.narration ?? void 0,
        customerId: l.customerId ?? void 0,
        bookingId: l.bookingId ?? void 0,
        vendorId: l.vendorId ?? void 0,
        brokerId: l.brokerId ?? void 0
      })),
      source: { type: original.source?.type ?? "manual", id: original.source?.id ?? void 0 },
      reversalOf: original._id,
      allowControlAccounts: true
    },
    session
  );
  const linked = await JournalEntry.updateOne(
    { companyId: actor.companyId, _id: original._id, reversedBy: null },
    { $set: { reversedBy: reversal._id, reversalReason: reason } },
    { session }
  );
  if (linked.modifiedCount !== 1) throw businessRule("This entry has already been reversed");
  return reversal;
}
async function resolveCashAccountFor(companyId, accountId, mode, session) {
  if (accountId) {
    if (!Types4.ObjectId.isValid(accountId)) throw businessRule("Choose an active cash or bank account");
    const acc = await Account.findOne({ companyId, _id: new Types4.ObjectId(accountId), type: "asset", isActive: true }).session(session).lean();
    const isCashLike = acc && (acc.systemKey === "cash" || acc.systemKey === "bank" || acc.isBank || !acc.systemKey);
    if (!isCashLike) throw businessRule("Choose an active cash or bank account");
    return acc._id;
  }
  return systemAccountId(companyId, mode === "cash" ? "cash" : "bank", session);
}
async function partyBalance(companyId, party, accountKey, session) {
  const accountId = await systemAccountId(companyId, accountKey, session);
  const [field, value] = Object.entries(party).find(([, v]) => v);
  const rows = await JournalEntry.aggregate(
    [
      { $match: { companyId, [`lines.${field}`]: value } },
      { $unwind: "$lines" },
      { $match: { "lines.accountId": accountId, [`lines.${field}`]: value } },
      { $group: { _id: null, debit: { $sum: "$lines.debitPaise" }, credit: { $sum: "$lines.creditPaise" } } }
    ],
    { session }
  );
  return (rows[0]?.credit ?? 0) - (rows[0]?.debit ?? 0);
}
async function nextDocumentNumber(companyId, series, date, session) {
  const fy = financialYear(date);
  const seq = await nextSequence(companyId, `${series.toLowerCase()}:${fy}`, session);
  return `${series}/${fy}/${String(seq).padStart(6, "0")}`;
}

// src/modules/accounting/accounting.service.ts
async function listAccounts(ctx) {
  return Account.find({ companyId: ctx.companyId }).sort({ code: 1 }).lean();
}
async function createAccount(ctx, input) {
  if (input.parentId) {
    const parent = await Account.findOne({ companyId: ctx.companyId, _id: toObjectId(input.parentId) }).lean();
    if (!parent) throw badRequest("Parent account not found");
    if (parent.type !== input.type) throw badRequest("Parent account must be of the same type");
  }
  if (input.isBank && input.type !== "asset") throw badRequest("Bank accounts must be asset accounts");
  const account = await Account.create({ companyId: ctx.companyId, ...input });
  await audit(ctx, {
    action: "accounting.account_create",
    entityType: "account",
    entityId: account._id,
    summary: `${account.code} ${account.name}`
  });
  return account.toJSON();
}
async function updateAccount(ctx, id, input) {
  const account = await Account.findOne({ companyId: ctx.companyId, _id: toObjectId(id) });
  if (!account) throw notFound("Account");
  if (input.isActive === false && account.systemKey) throw businessRule("System accounts cannot be deactivated");
  account.set(input);
  await account.save();
  await audit(ctx, { action: "accounting.account_update", entityType: "account", entityId: account._id, changes: input });
  return account.toJSON();
}
async function createManualEntry(ctx, input) {
  if (input.projectId) {
    assertProjectAccess(ctx, input.projectId);
    if (!await Project.exists({ companyId: ctx.companyId, _id: toObjectId(input.projectId) })) throw badRequest("Project not found");
  } else if (ctx.projectScope !== null) {
    throw badRequest("Select one of your projects for this voucher");
  }
  return withTransaction(async (session) => {
    const entry = await postJournal(
      ctx,
      {
        date: input.date,
        voucherType: "journal",
        narration: input.narration,
        reference: input.reference,
        projectId: input.projectId,
        lines: input.lines,
        source: { type: "manual" }
      },
      session
    );
    await audit(
      ctx,
      { action: "accounting.journal_post", entityType: "journal_entry", entityId: entry._id, summary: entry.entryNumber },
      session
    );
    return entry.toJSON();
  });
}
async function reverseManualEntry(ctx, id, reason, date) {
  return withTransaction(async (session) => {
    const entry = await JournalEntry.findOne({ companyId: ctx.companyId, _id: toObjectId(id) }).session(session).lean();
    if (!entry) throw notFound("Journal entry");
    if (entry.projectId) assertProjectAccess(ctx, entry.projectId);
    if (entry.source?.type !== "manual") {
      throw businessRule("System entries are corrected through their source document (cancel the booking or reverse the receipt)");
    }
    const reversal = await reverseJournal(ctx, entry._id, reason, session, date ?? todayInIndia());
    await audit(
      ctx,
      {
        action: "accounting.journal_reverse",
        entityType: "journal_entry",
        entityId: entry._id,
        summary: `${entry.entryNumber} reversed by ${reversal.entryNumber}`,
        changes: { reason }
      },
      session
    );
    return reversal.toJSON();
  });
}
function projectMatch(ctx, projectId) {
  if (projectId) {
    assertProjectAccess(ctx, projectId);
    return { projectId: toObjectId(projectId) };
  }
  return ctx.projectScope !== null ? { projectId: { $in: ctx.projectScope } } : {};
}
async function listEntries(ctx, q) {
  const filter = { companyId: ctx.companyId, ...projectMatch(ctx, q.projectId) };
  if (q.from || q.to) filter.date = { ...q.from ? { $gte: parseISODate(q.from) } : {}, ...q.to ? { $lte: parseISODate(q.to) } : {} };
  if (q.accountId) filter["lines.accountId"] = toObjectId(q.accountId);
  if (q.voucherType) filter.voucherType = q.voucherType;
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), "i");
    filter.$or = [{ entryNumber: rx }, { narration: rx }, { reference: rx }];
  }
  const [items, total] = await Promise.all([
    JournalEntry.find(filter).sort({ date: -1, createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).populate({ path: "lines.accountId", select: "code name", match: { companyId: ctx.companyId } }).lean(),
    JournalEntry.countDocuments(filter)
  ]);
  return { items, meta: pageMeta(q.page, q.pageSize, total) };
}
async function getEntry(ctx, id) {
  const entry = await JournalEntry.findOne({ companyId: ctx.companyId, _id: toObjectId(id) }).populate({ path: "lines.accountId", select: "code name type", match: { companyId: ctx.companyId } }).populate({ path: "lines.customerId", select: "name customerCode", match: { companyId: ctx.companyId } }).populate("postedBy", "name").lean();
  if (!entry) throw notFound("Journal entry");
  if (entry.projectId) assertProjectAccess(ctx, entry.projectId);
  return entry;
}
async function balancesByAccount(ctx, dateMatch, projectId) {
  const rows = await JournalEntry.aggregate([
    { $match: { companyId: ctx.companyId, ...projectMatch(ctx, projectId), ...dateMatch } },
    { $unwind: "$lines" },
    { $group: { _id: "$lines.accountId", debitPaise: { $sum: "$lines.debitPaise" }, creditPaise: { $sum: "$lines.creditPaise" } } }
  ]);
  return new Map(rows.map((r) => [String(r._id), r]));
}
function signedBalance(type, debit, credit) {
  return NORMAL_BALANCE[type] === "debit" ? debit - credit : credit - debit;
}
async function trialBalance(ctx, asOf = todayInIndia(), projectId) {
  const [accounts, balances] = await Promise.all([
    Account.find({ companyId: ctx.companyId }).sort({ code: 1 }).lean(),
    balancesByAccount(ctx, { date: { $lte: parseISODate(asOf) } }, projectId)
  ]);
  const rows = accounts.map((a) => {
    const b = balances.get(String(a._id));
    const net = (b?.debitPaise ?? 0) - (b?.creditPaise ?? 0);
    return {
      accountId: String(a._id),
      code: a.code,
      name: a.name,
      type: a.type,
      debitPaise: net > 0 ? net : 0,
      creditPaise: net < 0 ? -net : 0
    };
  }).filter((r) => r.debitPaise || r.creditPaise);
  const totals = { debitPaise: rows.reduce((s, r) => s + r.debitPaise, 0), creditPaise: rows.reduce((s, r) => s + r.creditPaise, 0) };
  return { asOf, rows, totals, balanced: totals.debitPaise === totals.creditPaise };
}
async function profitAndLoss(ctx, from, to, projectId) {
  const [accounts, balances] = await Promise.all([
    Account.find({ companyId: ctx.companyId, type: { $in: ["income", "expense"] } }).sort({ code: 1 }).lean(),
    balancesByAccount(ctx, { date: { $gte: parseISODate(from), $lte: parseISODate(to) } }, projectId)
  ]);
  const section = (type) => accounts.filter((a) => a.type === type).map((a) => {
    const b = balances.get(String(a._id));
    return {
      accountId: String(a._id),
      code: a.code,
      name: a.name,
      amountPaise: signedBalance(type, b?.debitPaise ?? 0, b?.creditPaise ?? 0)
    };
  }).filter((r) => r.amountPaise !== 0);
  const income = section("income");
  const expenses = section("expense");
  const totalIncome = income.reduce((s, r) => s + r.amountPaise, 0);
  const totalExpenses = expenses.reduce((s, r) => s + r.amountPaise, 0);
  return {
    from,
    to,
    income,
    expenses,
    totalIncomePaise: totalIncome,
    totalExpensesPaise: totalExpenses,
    netProfitPaise: totalIncome - totalExpenses
  };
}
async function balanceSheet(ctx, asOf = todayInIndia(), projectId) {
  const [accounts, balances] = await Promise.all([
    Account.find({ companyId: ctx.companyId }).sort({ code: 1 }).lean(),
    balancesByAccount(ctx, { date: { $lte: parseISODate(asOf) } }, projectId)
  ]);
  const rowsOf = (type) => accounts.filter((a) => a.type === type).map((a) => {
    const b = balances.get(String(a._id));
    return {
      accountId: String(a._id),
      code: a.code,
      name: a.name,
      amountPaise: signedBalance(type, b?.debitPaise ?? 0, b?.creditPaise ?? 0)
    };
  }).filter((r) => r.amountPaise !== 0);
  const sum = (rows) => rows.reduce((s, r) => s + r.amountPaise, 0);
  const assets = rowsOf("asset");
  const liabilities = rowsOf("liability");
  const equity = rowsOf("equity");
  const retainedEarnings = sum(rowsOf("income")) - sum(rowsOf("expense"));
  const totalEquity = sum(equity) + retainedEarnings;
  return {
    asOf,
    assets,
    liabilities,
    equity,
    retainedEarningsPaise: retainedEarnings,
    totalAssetsPaise: sum(assets),
    totalLiabilitiesPaise: sum(liabilities),
    totalEquityPaise: totalEquity,
    balanced: sum(assets) === sum(liabilities) + totalEquity
  };
}
async function accountLedger(ctx, accountId, from, to, projectId) {
  const account = await Account.findOne({ companyId: ctx.companyId, _id: toObjectId(accountId) }).lean();
  if (!account) throw notFound("Account");
  const pm = projectMatch(ctx, projectId);
  const opening = await JournalEntry.aggregate([
    { $match: { companyId: ctx.companyId, ...pm, "lines.accountId": account._id, date: { $lt: parseISODate(from) } } },
    { $unwind: "$lines" },
    { $match: { "lines.accountId": account._id } },
    { $group: { _id: null, debit: { $sum: "$lines.debitPaise" }, credit: { $sum: "$lines.creditPaise" } } }
  ]);
  const rows = await JournalEntry.aggregate([
    {
      $match: {
        companyId: ctx.companyId,
        ...pm,
        "lines.accountId": account._id,
        date: { $gte: parseISODate(from), $lte: parseISODate(to) }
      }
    },
    { $sort: { date: 1, createdAt: 1, _id: 1 } },
    { $limit: 5e3 },
    { $unwind: "$lines" },
    { $match: { "lines.accountId": account._id } },
    {
      $project: {
        entryNumber: 1,
        date: 1,
        voucherType: 1,
        narration: { $ifNull: ["$lines.narration", "$narration"] },
        debitPaise: "$lines.debitPaise",
        creditPaise: "$lines.creditPaise"
      }
    }
  ]);
  const type = account.type;
  const openingBalance = signedBalance(type, opening[0]?.debit ?? 0, opening[0]?.credit ?? 0);
  let running = openingBalance;
  const entries = rows.map((r) => {
    running += signedBalance(type, r.debitPaise, r.creditPaise);
    return { ...r, balancePaise: running };
  });
  return {
    account: { id: String(account._id), code: account.code, name: account.name, type },
    from,
    to,
    openingBalancePaise: openingBalance,
    entries,
    closingBalancePaise: running
  };
}

// src/modules/accounting/accounting.routes.ts
var accountingRouter = Router();
accountingRouter.get("/accounts", authorize("accounting.read"), async (req, res) => ok(res, await listAccounts(getCtx(req))));
accountingRouter.post(
  "/accounts",
  authorize("accounting.manageAccounts"),
  validate({ body: accountSchema }),
  async (req, res) => created(res, await createAccount(getCtx(req), body(req)))
);
accountingRouter.patch(
  "/accounts/:id",
  authorize("accounting.manageAccounts"),
  validate({ params: idParam, body: accountUpdateSchema }),
  async (req, res) => ok(res, await updateAccount(getCtx(req), params(req).id, body(req)))
);
var entryQuery = journalListQuerySchema.extend({ projectId: objectId.optional() });
accountingRouter.get("/journal-entries", authorize("accounting.read"), validate({ query: entryQuery }), async (req, res) => {
  const { items, meta: meta2 } = await listEntries(getCtx(req), query(req));
  ok(res, items, meta2);
});
accountingRouter.post(
  "/journal-entries",
  authorize("accounting.create"),
  validate({ body: journalEntrySchema }),
  async (req, res) => created(res, await createManualEntry(getCtx(req), body(req)))
);
accountingRouter.get(
  "/journal-entries/:id",
  authorize("accounting.read"),
  validate({ params: idParam }),
  async (req, res) => ok(res, await getEntry(getCtx(req), params(req).id))
);
accountingRouter.post(
  "/journal-entries/:id/reverse",
  authorize("accounting.reverse"),
  validate({ params: idParam, body: reverseEntrySchema }),
  async (req, res) => {
    const b = body(req);
    ok(res, await reverseManualEntry(getCtx(req), params(req).id, b.reason, b.date));
  }
);
function defaultRange(q) {
  const today = todayInIndia();
  return { from: q.from ?? `${financialYear(today).slice(0, 4)}-04-01`, to: q.to ?? today };
}
accountingRouter.get(
  "/reports/trial-balance",
  authorize("reports.read", "accounting.read"),
  validate({ query: asOfSchema }),
  async (req, res) => {
    const q = query(req);
    ok(res, await trialBalance(getCtx(req), q.asOf, q.projectId));
  }
);
accountingRouter.get(
  "/reports/profit-loss",
  authorize("reports.read", "accounting.read"),
  validate({ query: reportRangeSchema }),
  async (req, res) => {
    const q = query(req);
    const r = defaultRange(q);
    ok(res, await profitAndLoss(getCtx(req), r.from, r.to, q.projectId));
  }
);
accountingRouter.get(
  "/reports/balance-sheet",
  authorize("reports.read", "accounting.read"),
  validate({ query: asOfSchema }),
  async (req, res) => {
    const q = query(req);
    ok(res, await balanceSheet(getCtx(req), q.asOf, q.projectId));
  }
);
accountingRouter.get(
  "/reports/ledger/:id",
  authorize("reports.read", "accounting.read"),
  validate({ params: idParam, query: reportRangeSchema }),
  async (req, res) => {
    const q = query(req);
    const r = defaultRange(q);
    ok(res, await accountLedger(getCtx(req), params(req).id, r.from, r.to, q.projectId));
  }
);

// src/modules/admin.routes.ts
import { Router as Router2 } from "express";
import { z as z11 } from "zod";

// src/modules/companies/company.service.ts
function slugify(name) {
  const base2 = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `${base2 || "company"}-${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}
async function createCompanyWithDefaults(input, session) {
  const [company] = await Company.create([{ name: input.name, slug: slugify(input.name), createdBy: input.ownerUserId }], { session });
  const companyId = company._id;
  const roles = await Role.create(
    Object.entries(SYSTEM_ROLES).map(([systemKey, r]) => ({
      companyId,
      systemKey,
      name: r.name,
      description: r.description,
      permissions: r.permissions,
      isSystem: true
    })),
    { session, ordered: true }
  );
  await Account.create(
    SYSTEM_ACCOUNTS.map((a) => ({
      companyId,
      ...a,
      isBank: a.systemKey === "bank",
      cashBankKind: a.systemKey === "bank" ? "bank" : a.systemKey === "cash" ? "cash" : void 0
    })),
    { session, ordered: true }
  );
  const ownerRole = roles.find((r) => r.systemKey === "owner");
  await Membership.create(
    [{ companyId, userId: input.ownerUserId, roleId: ownerRole._id, status: "active", projectAccess: { mode: "all" } }],
    {
      session
    }
  );
  return company;
}
async function getCompany(ctx) {
  const company = await Company.findById(ctx.companyId).lean();
  if (!company) throw notFound("Company");
  return company;
}
async function updateCompany(ctx, input) {
  const set = {};
  for (const [k, v] of Object.entries(input)) {
    if (k === "settings" && v) {
      for (const [sk, sv] of Object.entries(v)) if (sv !== void 0) set[`settings.${sk}`] = sv;
    } else if (v !== void 0) set[k] = v;
  }
  const company = await Company.findByIdAndUpdate(ctx.companyId, { $set: set }, { new: true, runValidators: true }).lean();
  if (!company) throw notFound("Company");
  await audit(ctx, { action: "company.update", entityType: "company", entityId: ctx.companyId, changes: set });
  return company;
}

// src/modules/roles/roles.service.ts
async function listRoles(ctx) {
  const roles = await Role.find({ companyId: ctx.companyId }).sort({ isSystem: -1, name: 1 }).lean();
  const counts = await Membership.aggregate([
    { $match: { companyId: ctx.companyId, status: "active" } },
    { $group: { _id: "$roleId", n: { $sum: 1 } } }
  ]);
  return roles.map((r) => ({ ...r, id: String(r._id), memberCount: counts.find((c) => String(c._id) === String(r._id))?.n ?? 0 }));
}
async function createRole(ctx, input) {
  const role = await Role.create({ companyId: ctx.companyId, ...input, permissions: [...new Set(input.permissions)], isSystem: false });
  await audit(ctx, {
    action: "roles.create",
    entityType: "role",
    entityId: role._id,
    changes: { name: role.name, permissions: role.permissions }
  });
  return role.toJSON();
}
async function updateRole(ctx, id, input) {
  const role = await Role.findOne({ companyId: ctx.companyId, _id: toObjectId(id) });
  if (!role) throw notFound("Role");
  if (role.systemKey === "owner" && input.permissions) throw businessRule("Owner permissions cannot be changed");
  if (String(role._id) === String(ctx.roleId) && input.permissions && !input.permissions.includes("roles.update")) {
    throw businessRule("You cannot remove role management from your own role");
  }
  const before = { name: role.name, permissions: [...role.permissions] };
  if (input.name !== void 0) role.name = input.name;
  if (input.description !== void 0) role.description = input.description;
  if (input.permissions) role.set("permissions", [...new Set(input.permissions)]);
  await role.save();
  await audit(ctx, {
    action: "roles.update",
    entityType: "role",
    entityId: role._id,
    changes: { before, after: { name: role.name, permissions: role.permissions } }
  });
  return role.toJSON();
}
async function deleteRole(ctx, id) {
  const role = await Role.findOne({ companyId: ctx.companyId, _id: toObjectId(id) });
  if (!role) throw notFound("Role");
  if (role.isSystem) throw businessRule("System roles cannot be deleted");
  if (await Membership.exists({ companyId: ctx.companyId, roleId: role._id }))
    throw businessRule("Reassign members before deleting this role");
  await Role.deleteOne({ companyId: ctx.companyId, _id: role._id });
  await audit(ctx, { action: "roles.delete", entityType: "role", entityId: role._id, summary: role.name });
}

// src/modules/users/users.service.ts
import { Types as Types5 } from "mongoose";

// src/utils/mailer.ts
import nodemailer from "nodemailer";
var testOutbox = [];
var transporter = null;
if (env.SMTP_URL) transporter = nodemailer.createTransport(env.SMTP_URL);
async function sendMail(mail) {
  if (env.isTest) {
    testOutbox.push(mail);
    return;
  }
  if (!transporter) {
    if (env.isProd) logger.error({ to: mail.to, subject: mail.subject }, "SMTP_URL not configured; email not sent");
    else logger.info({ to: mail.to, subject: mail.subject, text: mail.text }, "Email (dev, not sent)");
    return;
  }
  try {
    await transporter.sendMail({ from: env.MAIL_FROM, ...mail });
  } catch (err) {
    logger.error({ err, to: mail.to }, "Failed to send email");
  }
}

// src/modules/users/users.service.ts
async function assertRole(ctx, roleId) {
  const role = await Role.findOne({ companyId: ctx.companyId, _id: toObjectId(roleId) }).lean();
  if (!role) throw badRequest("Role not found in this company");
  return role;
}
async function normalizeProjectAccess(ctx, access) {
  if (access.mode === "all") return { mode: "all", projectIds: [] };
  const ids = [...new Set(access.projectIds)].map((id) => new Types5.ObjectId(id));
  const count = await Project.countDocuments({ companyId: ctx.companyId, _id: { $in: ids } });
  if (count !== ids.length) throw badRequest("One or more projects do not belong to this company");
  return { mode: "restricted", projectIds: ids };
}
async function listMembers(ctx, q) {
  const userFilter = q.q ? { $or: [{ name: new RegExp(escapeRegex(q.q), "i") }, { email: new RegExp(escapeRegex(q.q), "i") }] } : null;
  const filter = { companyId: ctx.companyId };
  if (userFilter) {
    const users = await User.find(userFilter).select("_id").limit(500).lean();
    filter.userId = { $in: users.map((u) => u._id) };
  }
  const [items, total] = await Promise.all([
    Membership.find(filter).sort({ createdAt: 1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).populate("userId", "name email lastLoginAt emailVerifiedAt isActive").populate({ path: "roleId", select: "name systemKey", match: { companyId: ctx.companyId } }).lean(),
    Membership.countDocuments(filter)
  ]);
  return { items, meta: pageMeta(q.page, q.pageSize, total) };
}
async function inviteUser(ctx, input) {
  await assertRole(ctx, input.roleId);
  const projectAccess = await normalizeProjectAccess(ctx, input.projectAccess);
  const existingUser = await User.findOne({ email: input.email }).select("_id").lean();
  if (existingUser && await Membership.exists({ companyId: ctx.companyId, userId: existingUser._id, status: "active" })) {
    throw conflict("This user is already a member of the company");
  }
  await Invitation.updateMany({ companyId: ctx.companyId, email: input.email, status: "pending" }, { $set: { status: "revoked" } });
  const token = randomToken();
  const invitation = await Invitation.create({
    companyId: ctx.companyId,
    email: input.email,
    roleId: input.roleId,
    projectAccess,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + 7 * 864e5),
    invitedBy: ctx.userId
  });
  const company = await Company.findById(ctx.companyId).select("name").lean();
  await sendMail({
    to: input.email,
    subject: `You're invited to ${company?.name ?? "a company"}`,
    text: `You have been invited to join ${company?.name} on Real Estate ERP.

Accept the invitation:
${env.APP_URL}/accept-invite?token=${token}

This link expires in 7 days.`
  });
  await audit(ctx, {
    action: "users.invite",
    entityType: "invitation",
    entityId: invitation._id,
    summary: input.email,
    changes: { roleId: input.roleId }
  });
  return { id: String(invitation._id), email: invitation.email, expiresAt: invitation.expiresAt };
}
async function listInvitations(ctx) {
  return Invitation.find({ companyId: ctx.companyId, status: "pending", expiresAt: { $gt: /* @__PURE__ */ new Date() } }).populate({ path: "roleId", select: "name", match: { companyId: ctx.companyId } }).sort({ createdAt: -1 }).lean();
}
async function revokeInvitation(ctx, id) {
  const res = await Invitation.updateOne(
    { companyId: ctx.companyId, _id: toObjectId(id), status: "pending" },
    { $set: { status: "revoked" } }
  );
  if (!res.matchedCount) throw notFound("Invitation");
  await audit(ctx, { action: "users.invitation_revoked", entityType: "invitation", entityId: id });
}
async function updateMembership(ctx, membershipId, input) {
  return withTransaction(async (session) => {
    const membership = await Membership.findOne({ companyId: ctx.companyId, _id: toObjectId(membershipId) }).session(session);
    if (!membership) throw notFound("User");
    if (input.status && input.status !== membership.status) requirePermission(ctx, "users.deactivate");
    if (String(membership.userId) === String(ctx.userId) && (input.roleId || input.status)) {
      throw forbidden("You cannot change your own role or status");
    }
    const before = { roleId: String(membership.roleId), status: membership.status, projectAccess: membership.projectAccess };
    const ownerRole = await Role.findOne({ companyId: ctx.companyId, systemKey: "owner" }).session(session).lean();
    const wasActiveOwner = String(membership.roleId) === String(ownerRole?._id) && membership.status === "active";
    if (input.roleId) membership.roleId = (await assertRole(ctx, input.roleId))._id;
    if (input.projectAccess) membership.set("projectAccess", await normalizeProjectAccess(ctx, input.projectAccess));
    if (input.status) membership.status = input.status;
    const stillActiveOwner = String(membership.roleId) === String(ownerRole?._id) && membership.status === "active";
    if (wasActiveOwner && !stillActiveOwner) {
      const owners = await Membership.countDocuments({ companyId: ctx.companyId, roleId: ownerRole._id, status: "active" }).session(
        session
      );
      if (owners <= 1) throw businessRule("The company must keep at least one active owner");
    }
    await membership.save({ session });
    await audit(
      ctx,
      {
        action: "users.membership_update",
        entityType: "membership",
        entityId: membership._id,
        changes: {
          before,
          after: { roleId: String(membership.roleId), status: membership.status, projectAccess: membership.projectAccess }
        }
      },
      session
    );
    return membership.toJSON();
  });
}

// src/modules/admin.routes.ts
var adminRouter = Router2();
adminRouter.get("/company", authorize("company.read"), async (req, res) => ok(res, await getCompany(getCtx(req))));
adminRouter.patch(
  "/company",
  authorize("company.update"),
  validate({ body: companyUpdateSchema }),
  async (req, res) => ok(res, await updateCompany(getCtx(req), body(req)))
);
adminRouter.get("/users", authorize("users.read"), validate({ query: listQuerySchema }), async (req, res) => {
  const { items, meta: meta2 } = await listMembers(getCtx(req), query(req));
  ok(res, items, meta2);
});
adminRouter.patch(
  "/users/:id",
  authorize("users.update"),
  validate({ params: idParam, body: updateMembershipSchema }),
  async (req, res) => ok(res, await updateMembership(getCtx(req), params(req).id, body(req)))
);
adminRouter.get("/invitations", authorize("users.read"), async (req, res) => ok(res, await listInvitations(getCtx(req))));
adminRouter.post(
  "/invitations",
  authorize("users.create"),
  validate({ body: inviteUserSchema }),
  async (req, res) => created(res, await inviteUser(getCtx(req), body(req)))
);
adminRouter.delete("/invitations/:id", authorize("users.create"), validate({ params: idParam }), async (req, res) => {
  await revokeInvitation(getCtx(req), params(req).id);
  ok(res, { revoked: true });
});
adminRouter.get("/members", async (req, res) => {
  const ctx = getCtx(req);
  const members = await Membership.find({ companyId: ctx.companyId, status: "active" }).populate("userId", "name").lean();
  ok(
    res,
    members.map((m) => m.userId).filter(Boolean).map((u) => ({ id: String(u._id), name: u.name })).sort((a, b) => a.name.localeCompare(b.name))
  );
});
adminRouter.get("/permissions", (_req, res) => ok(res, { groups: PERMISSION_GROUPS, labels: PERMISSION_LABELS, all: ALL_PERMISSIONS }));
adminRouter.get("/roles", authorize("roles.read"), async (req, res) => ok(res, await listRoles(getCtx(req))));
adminRouter.post(
  "/roles",
  authorize("roles.create"),
  validate({ body: roleSchema }),
  async (req, res) => created(res, await createRole(getCtx(req), body(req)))
);
adminRouter.patch(
  "/roles/:id",
  authorize("roles.update"),
  validate({ params: idParam, body: patchSchema(roleSchema) }),
  async (req, res) => ok(res, await updateRole(getCtx(req), params(req).id, body(req)))
);
adminRouter.delete("/roles/:id", authorize("roles.delete"), validate({ params: idParam }), async (req, res) => {
  await deleteRole(getCtx(req), params(req).id);
  ok(res, { deleted: true });
});
var auditQuery = listQuerySchema.extend({
  entityType: z11.string().max(40).optional(),
  entityId: objectId.optional(),
  actorId: objectId.optional(),
  action: z11.string().max(60).optional(),
  from: isoDate.optional(),
  to: isoDate.optional()
});
adminRouter.get("/audit-logs", authorize("audit.read"), validate({ query: auditQuery }), async (req, res) => {
  const ctx = getCtx(req);
  const q = query(req);
  const filter = { companyId: ctx.companyId };
  if (q.entityType) filter.entityType = q.entityType;
  if (q.entityId) filter.entityId = q.entityId;
  if (q.actorId) filter.actorId = q.actorId;
  if (q.action) filter.action = new RegExp(`^${escapeRegex(q.action)}`);
  if (q.from || q.to) {
    filter.createdAt = {
      ...q.from ? { $gte: /* @__PURE__ */ new Date(`${q.from}T00:00:00+05:30`) } : {},
      ...q.to ? { $lt: new Date((/* @__PURE__ */ new Date(`${q.to}T00:00:00+05:30`)).getTime() + 864e5) } : {}
    };
  }
  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).populate("actorId", "name email").lean(),
    AuditLog.countDocuments(filter)
  ]);
  ok(res, items, pageMeta(q.page, q.pageSize, total));
});
adminRouter.get(
  "/notifications",
  validate({ query: listQuerySchema.extend({ unread: z11.enum(["true", "false"]).optional() }) }),
  async (req, res) => {
    const ctx = getCtx(req);
    const q = query(req);
    const filter = { companyId: ctx.companyId, userId: ctx.userId };
    if (q.unread === "true") filter.readAt = null;
    const [items, total, unread] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(),
      Notification.countDocuments(filter),
      Notification.countDocuments({ companyId: ctx.companyId, userId: ctx.userId, readAt: null })
    ]);
    res.setHeader("x-unread-count", String(unread));
    ok(res, { items, unread }, pageMeta(q.page, q.pageSize, total));
  }
);
adminRouter.post("/notifications/:id/read", validate({ params: idParam }), async (req, res) => {
  const ctx = getCtx(req);
  await Notification.updateOne(
    { companyId: ctx.companyId, userId: ctx.userId, _id: params(req).id },
    { $set: { readAt: /* @__PURE__ */ new Date() } }
  );
  ok(res, { read: true });
});
adminRouter.post("/notifications/read-all", async (req, res) => {
  const ctx = getCtx(req);
  await Notification.updateMany({ companyId: ctx.companyId, userId: ctx.userId, readAt: null }, { $set: { readAt: /* @__PURE__ */ new Date() } });
  ok(res, { read: true });
});

// src/modules/auth/auth.routes.ts
import { Router as Router3 } from "express";
import { z as z12 } from "zod";

// src/modules/auth/auth.service.ts
import { Types as Types6 } from "mongoose";

// src/modules/auth/password.ts
import argon2 from "argon2";
var options = {
  type: argon2.argon2id,
  memoryCost: env.isTest ? 8192 : env.ARGON2_MEMORY_KIB,
  timeCost: env.isTest ? 1 : 2,
  parallelism: 1
};
function hashPassword(password) {
  return argon2.hash(password, options);
}
async function verifyPassword(hash, password) {
  if (!hash) {
    await argon2.hash(password, options);
    return false;
  }
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

// src/modules/auth/auth.service.ts
var MAX_FAILED_LOGINS = 8;
var LOCK_MINUTES = 15;
var REFRESH_GRACE_MS = 15e3;
async function issueSession(userId, meta2, activeCompanyId) {
  const refreshToken = randomToken();
  const refreshExpiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 864e5);
  const session = await Session.create({
    userId,
    tokenHash: sha256(refreshToken),
    activeCompanyId,
    userAgent: meta2.userAgent?.slice(0, 300),
    ip: meta2.ip,
    expiresAt: refreshExpiresAt,
    lastUsedAt: /* @__PURE__ */ new Date()
  });
  const access = signAccessToken(String(userId), String(session._id));
  return {
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt,
    refreshToken,
    refreshExpiresAt,
    sessionId: String(session._id)
  };
}
async function createAuthToken(userId, type, ttlMs) {
  const token = randomToken();
  await AuthToken.create({ userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs) });
  return token;
}
async function sendVerificationEmail(user) {
  const token = await createAuthToken(user._id, "verify_email", 48 * 36e5);
  await sendMail({
    to: user.email,
    subject: "Verify your email address",
    text: `Hello ${user.name},

Please verify your email address:
${env.APP_URL}/verify-email?token=${token}

This link expires in 48 hours.`
  });
}
async function register(input, meta2) {
  const existing = await User.exists({ email: input.email });
  if (existing) throw conflict("An account with this email already exists");
  const passwordHash = await hashPassword(input.password);
  const { user, company } = await withTransaction(async (session) => {
    const [user2] = await User.create([{ name: input.name, email: input.email, passwordHash }], { session });
    const company2 = await createCompanyWithDefaults({ name: input.companyName, ownerUserId: user2._id }, session);
    await audit(
      { companyId: company2._id, userId: user2._id, meta: meta2 },
      { action: "auth.register", entityType: "user", entityId: user2._id, summary: `Registered and created ${company2.name}` },
      session
    );
    return { user: user2, company: company2 };
  });
  await sendVerificationEmail(user);
  return issueSession(user._id, meta2, company._id);
}
async function login(email3, password, meta2) {
  const user = await User.findOne({ email: email3 }).select("+passwordHash");
  if (user?.lockedUntil && user.lockedUntil > /* @__PURE__ */ new Date()) {
    throw new AppError(429, "RATE_LIMITED", "Too many failed attempts. Try again in a few minutes.");
  }
  const valid = await verifyPassword(user?.passwordHash, password);
  if (!user || !valid || !user.isActive) {
    if (user) {
      const failed = (user.failedLoginCount ?? 0) + 1;
      user.failedLoginCount = failed >= MAX_FAILED_LOGINS ? 0 : failed;
      if (failed >= MAX_FAILED_LOGINS) user.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 6e4);
      await user.save();
    }
    await audit(null, { action: "auth.login_failed", entityType: "user", entityId: user?._id, summary: email3 });
    throw unauthenticated("Invalid email or password");
  }
  user.failedLoginCount = 0;
  user.lockedUntil = void 0;
  user.lastLoginAt = /* @__PURE__ */ new Date();
  await user.save();
  const memberships = await Membership.find({ userId: user._id, status: "active" }, null, { crossTenant: true }).select("companyId").lean();
  const activeCompanyId = memberships.length === 1 ? memberships[0].companyId : void 0;
  const issued = await issueSession(user._id, meta2, activeCompanyId);
  await audit(
    { companyId: activeCompanyId, userId: user._id, meta: meta2 },
    { action: "auth.login", entityType: "session", entityId: new Types6.ObjectId(issued.sessionId) }
  );
  return issued;
}
async function refresh(refreshToken, meta2) {
  if (!refreshToken) throw unauthenticated("No session");
  const hash = sha256(refreshToken);
  const newToken2 = randomToken();
  const now = /* @__PURE__ */ new Date();
  const session = await Session.findOneAndUpdate(
    { tokenHash: hash, revokedAt: null, expiresAt: { $gt: now } },
    { $set: { tokenHash: sha256(newToken2), previousTokenHash: hash, rotatedAt: now, lastUsedAt: now, ip: meta2.ip } },
    { new: true }
  );
  if (!session) {
    const reused = await Session.findOne({ previousTokenHash: hash });
    if (reused && !reused.revokedAt) {
      if (reused.rotatedAt && now.getTime() - reused.rotatedAt.getTime() < REFRESH_GRACE_MS) {
        throw new AppError(409, "CONFLICT", "Session was just refreshed. Retry the request.");
      }
      reused.revokedAt = now;
      reused.revokedReason = "refresh_token_reuse";
      await reused.save();
      await audit(
        { companyId: reused.activeCompanyId, userId: reused.userId, meta: meta2 },
        { action: "auth.refresh_reuse_detected", entityType: "session", entityId: reused._id }
      );
    }
    throw unauthenticated("Session expired. Please sign in again.");
  }
  const user = await User.findById(session.userId).select("isActive").lean();
  if (!user?.isActive) {
    session.revokedAt = now;
    session.revokedReason = "user_disabled";
    await session.save();
    throw unauthenticated("Account is disabled");
  }
  const access = signAccessToken(String(session.userId), String(session._id));
  return {
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt,
    refreshToken: newToken2,
    refreshExpiresAt: session.expiresAt,
    sessionId: String(session._id)
  };
}
async function revokeSessionByToken(refreshToken) {
  if (!refreshToken) return;
  await Session.updateOne(
    { tokenHash: sha256(refreshToken), revokedAt: null },
    { $set: { revokedAt: /* @__PURE__ */ new Date(), revokedReason: "logout" } }
  );
}
async function listSessions(userId, currentSessionId) {
  const sessions = await Session.find({ userId, revokedAt: null, expiresAt: { $gt: /* @__PURE__ */ new Date() } }).select("userAgent ip createdAt lastUsedAt expiresAt").sort({ lastUsedAt: -1 }).lean();
  return sessions.map((s) => ({
    id: String(s._id),
    userAgent: s.userAgent,
    ip: s.ip,
    createdAt: s.createdAt,
    lastUsedAt: s.lastUsedAt,
    current: String(s._id) === currentSessionId
  }));
}
async function revokeSession(userId, sessionId) {
  const res = await Session.updateOne(
    { _id: sessionId, userId, revokedAt: null },
    { $set: { revokedAt: /* @__PURE__ */ new Date(), revokedReason: "user_revoked" } }
  );
  if (res.matchedCount === 0) throw notFound("Session");
}
async function revokeAllSessions(userId, reason, exceptSessionId) {
  await Session.updateMany(
    { userId, revokedAt: null, ...exceptSessionId ? { _id: { $ne: exceptSessionId } } : {} },
    { $set: { revokedAt: /* @__PURE__ */ new Date(), revokedReason: reason } }
  );
}
async function selectCompany(userId, sessionId, companyId) {
  const membership = await Membership.findOne({ companyId: new Types6.ObjectId(companyId), userId, status: "active" }).lean();
  if (!membership) throw notFound("Company");
  await Session.updateOne({ _id: sessionId, userId }, { $set: { activeCompanyId: membership.companyId } });
}
async function getAuthContext(userId, activeCompanyId) {
  const user = await User.findById(userId).lean();
  if (!user) throw unauthenticated();
  const memberships = await Membership.find({ userId: user._id, status: "active" }, null, { crossTenant: true }).lean();
  const companies = await Company.find({ _id: { $in: memberships.map((m) => m.companyId) }, isActive: true }).select("name").lean();
  const roles = await Role.find({ _id: { $in: memberships.map((m) => m.roleId) } }, null, { crossTenant: true }).select("name permissions systemKey").lean();
  const summaries = memberships.map((m) => {
    const company = companies.find((c) => String(c._id) === String(m.companyId));
    const role = roles.find((r) => String(r._id) === String(m.roleId));
    if (!company || !role) return null;
    return { id: String(company._id), name: company.name, roleName: role.name, membership: m, role };
  }).filter((x) => x !== null);
  const active = summaries.find((s) => s.id === activeCompanyId) ?? null;
  return {
    user: { id: String(user._id), name: user.name, email: user.email, emailVerified: Boolean(user.emailVerifiedAt) },
    companies: summaries.map(({ id, name, roleName }) => ({ id, name, roleName })),
    activeCompany: active ? {
      id: active.id,
      name: active.name,
      roleName: active.roleName,
      permissions: active.role.systemKey === "owner" ? ALL_PERMISSIONS : active.role.permissions,
      projectAccess: {
        mode: active.membership.projectAccess?.mode === "restricted" ? "restricted" : "all",
        projectIds: (active.membership.projectAccess?.projectIds ?? []).map(String)
      }
    } : null
  };
}
async function verifyEmail(token) {
  const record = await AuthToken.findOneAndUpdate(
    { tokenHash: sha256(token), type: "verify_email", usedAt: null, expiresAt: { $gt: /* @__PURE__ */ new Date() } },
    { $set: { usedAt: /* @__PURE__ */ new Date() } }
  );
  if (!record) throw badRequest("This verification link is invalid or has expired");
  await User.updateOne({ _id: record.userId }, { $set: { emailVerifiedAt: /* @__PURE__ */ new Date() } });
}
async function resendVerification(userId) {
  const user = await User.findById(userId).lean();
  if (!user || user.emailVerifiedAt) return;
  await sendVerificationEmail(user);
}
async function forgotPassword(email3) {
  const user = await User.findOne({ email: email3, isActive: true }).lean();
  if (!user) return;
  const token = await createAuthToken(user._id, "reset_password", 36e5);
  await sendMail({
    to: user.email,
    subject: "Reset your password",
    text: `Hello ${user.name},

Reset your password using this link (valid for 1 hour):
${env.APP_URL}/reset-password?token=${token}

If you did not request this, ignore this email.`
  });
}
async function resetPassword(token, password, meta2) {
  const record = await AuthToken.findOneAndUpdate(
    { tokenHash: sha256(token), type: "reset_password", usedAt: null, expiresAt: { $gt: /* @__PURE__ */ new Date() } },
    { $set: { usedAt: /* @__PURE__ */ new Date() } }
  );
  if (!record) throw badRequest("This reset link is invalid or has expired");
  const passwordHash = await hashPassword(password);
  await User.updateOne({ _id: record.userId }, { $set: { passwordHash, failedLoginCount: 0 }, $unset: { lockedUntil: 1 } });
  await revokeAllSessions(record.userId, "password_reset");
  await audit(null, { action: "auth.password_reset", entityType: "user", entityId: record.userId, summary: meta2.ip });
}
async function changePassword(userId, sessionId, current, next) {
  const user = await User.findById(userId).select("+passwordHash");
  if (!user || !await verifyPassword(user.passwordHash, current)) throw badRequest("Current password is incorrect");
  user.passwordHash = await hashPassword(next);
  await user.save();
  await revokeAllSessions(user._id, "password_changed", sessionId);
}
async function describeInvitation(token) {
  const inv = await Invitation.findOne({ tokenHash: sha256(token), status: "pending", expiresAt: { $gt: /* @__PURE__ */ new Date() } }, null, {
    crossTenant: true
  }).lean();
  if (!inv) throw notFound("Invitation");
  const company = await Company.findById(inv.companyId).select("name").lean();
  const userExists = Boolean(await User.exists({ email: inv.email }));
  return { email: inv.email, companyName: company?.name ?? "", userExists };
}
async function acceptInvitation(input, currentUserId, meta2) {
  const inv = await Invitation.findOne({ tokenHash: sha256(input.token), status: "pending", expiresAt: { $gt: /* @__PURE__ */ new Date() } }, null, {
    crossTenant: true
  });
  if (!inv) throw notFound("Invitation");
  const existing = await User.findOne({ email: inv.email }).select("_id").lean();
  let userId = existing?._id;
  let issued = null;
  await withTransaction(async (session) => {
    if (userId) {
      if (!currentUserId || String(userId) !== currentUserId) {
        throw new AppError(401, "UNAUTHENTICATED", `Sign in as ${inv.email} to accept this invitation`);
      }
    } else {
      if (!input.name || !input.password) throw badRequest("Name and password are required to create your account");
      const passwordHash = await hashPassword(input.password);
      const [created2] = await User.create([{ name: input.name, email: inv.email, passwordHash, emailVerifiedAt: /* @__PURE__ */ new Date() }], { session });
      userId = created2._id;
    }
    await Membership.findOneAndUpdate(
      { companyId: inv.companyId, userId },
      { $set: { roleId: inv.roleId, status: "active", projectAccess: inv.projectAccess, invitedBy: inv.invitedBy } },
      { upsert: true, session }
    );
    inv.status = "accepted";
    inv.acceptedAt = /* @__PURE__ */ new Date();
    await inv.save({ session });
    await audit(
      { companyId: inv.companyId, userId, meta: meta2 },
      { action: "users.invitation_accepted", entityType: "membership", entityId: userId, summary: inv.email },
      session
    );
  });
  if (!currentUserId) issued = await issueSession(userId, meta2, inv.companyId);
  return { issued, companyId: String(inv.companyId) };
}

// src/modules/auth/auth.routes.ts
var REFRESH_COOKIE = "erp_rt";
var REFRESH_PATH = "/api/v1/auth";
function cookieBase() {
  return { secure: env.cookieSecure, sameSite: "strict" };
}
function meta(req) {
  return { ip: req.ip, userAgent: req.get("user-agent") };
}
async function respondWithSession(req, res, issued, status = 200) {
  res.cookie(REFRESH_COOKIE, issued.refreshToken, {
    ...cookieBase(),
    httpOnly: true,
    path: REFRESH_PATH,
    expires: issued.refreshExpiresAt
  });
  res.cookie(CSRF_COOKIE, randomToken(24), { ...cookieBase(), httpOnly: false, path: "/", expires: issued.refreshExpiresAt });
  const session = await Session.findById(issued.sessionId).select("activeCompanyId userId").lean();
  const context = await getAuthContext(
    String(session.userId),
    session?.activeCompanyId ? String(session.activeCompanyId) : void 0
  );
  ok(
    res,
    { ...context, accessToken: issued.accessToken, accessTokenExpiresAt: issued.accessTokenExpiresAt.toISOString() },
    void 0,
    status
  );
}
function clearSessionCookies(res) {
  res.clearCookie(REFRESH_COOKIE, { ...cookieBase(), httpOnly: true, path: REFRESH_PATH });
  res.clearCookie(CSRF_COOKIE, { ...cookieBase(), path: "/" });
}
var authRouter = Router3();
authRouter.post("/register", credentialLimiter, validate({ body: registerSchema }), async (req, res) => {
  const issued = await register(body(req), meta(req));
  await respondWithSession(req, res, issued, 201);
});
authRouter.post("/login", credentialLimiter, validate({ body: loginSchema }), async (req, res) => {
  const { email: email3, password } = body(req);
  const issued = await login(email3, password, meta(req));
  await respondWithSession(req, res, issued);
});
authRouter.post("/refresh", requireCsrf, async (req, res) => {
  try {
    const issued = await refresh(req.cookies?.[REFRESH_COOKIE], meta(req));
    await respondWithSession(req, res, issued);
  } catch (err) {
    if (err.status === 401) clearSessionCookies(res);
    throw err;
  }
});
authRouter.post("/logout", requireCsrf, async (req, res) => {
  await revokeSessionByToken(req.cookies?.[REFRESH_COOKIE]);
  clearSessionCookies(res);
  ok(res, { loggedOut: true });
});
authRouter.get("/me", authenticate, async (req, res) => {
  ok(res, await getAuthContext(req.auth.userId, req.auth.companyId));
});
authRouter.post("/select-company", authenticate, validate({ body: selectCompanySchema }), async (req, res) => {
  const { companyId } = body(req);
  await selectCompany(req.auth.userId, req.auth.sessionId, companyId);
  ok(res, await getAuthContext(req.auth.userId, companyId));
});
authRouter.get("/sessions", authenticate, async (req, res) => {
  ok(res, await listSessions(req.auth.userId, req.auth.sessionId));
});
authRouter.delete(
  "/sessions/:id",
  authenticate,
  validate({ params: z12.object({ id: z12.string().regex(/^[a-f\d]{24}$/i) }) }),
  async (req, res) => {
    await revokeSession(req.auth.userId, params(req).id);
    ok(res, { revoked: true });
  }
);
authRouter.post("/change-password", authenticate, validate({ body: changePasswordSchema }), async (req, res) => {
  const { currentPassword, newPassword } = body(req);
  await changePassword(req.auth.userId, req.auth.sessionId, currentPassword, newPassword);
  ok(res, { changed: true });
});
authRouter.post("/verify-email", validate({ body: verifyEmailSchema }), async (req, res) => {
  await verifyEmail(body(req).token);
  ok(res, { verified: true });
});
authRouter.post("/resend-verification", authenticate, async (req, res) => {
  await resendVerification(req.auth.userId);
  ok(res, { sent: true });
});
authRouter.post("/forgot-password", credentialLimiter, validate({ body: forgotPasswordSchema }), async (req, res) => {
  await forgotPassword(body(req).email);
  ok(res, { message: "If an account exists for this email, a reset link has been sent." });
});
authRouter.post("/reset-password", credentialLimiter, validate({ body: resetPasswordSchema }), async (req, res) => {
  const { token, password } = body(req);
  await resetPassword(token, password, meta(req));
  clearSessionCookies(res);
  ok(res, { reset: true });
});
authRouter.get("/invitations/:token", validate({ params: z12.object({ token: z12.string().min(20).max(200) }) }), async (req, res) => {
  ok(res, await describeInvitation(params(req).token));
});
authRouter.post("/accept-invite", credentialLimiter, validate({ body: acceptInviteSchema }), async (req, res) => {
  let currentUserId;
  const header2 = req.headers.authorization;
  if (header2?.startsWith("Bearer ")) {
    try {
      currentUserId = verifyAccessToken(header2.slice(7)).sub;
    } catch {
      throw unauthenticated("Your session expired. Sign in again to accept the invitation.");
    }
  }
  const result = await acceptInvitation(body(req), currentUserId, meta(req));
  if (result.issued) return respondWithSession(req, res, result.issued, 201);
  ok(res, { accepted: true, companyId: result.companyId });
});

// src/modules/projects/projects.routes.ts
import { Router as Router4 } from "express";
import { z as z13 } from "zod";

// src/modules/plots/plots.service.ts
import { Types as Types7 } from "mongoose";
function computeListPrice(areaX100, ratePaisePerSqft, plcBp) {
  const base2 = priceForArea(areaX100, ratePaisePerSqft);
  return base2 + applyBasisPoints(base2, plcBp);
}
async function requireProject(ctx, projectId) {
  assertProjectAccess(ctx, projectId);
  const project = await Project.findOne({ companyId: ctx.companyId, _id: toObjectId(projectId) }).select("status map").lean();
  if (!project) throw notFound("Project");
  return project;
}
async function resolveHierarchy(ctx, projectId, phaseId, blockId) {
  let phase = phaseId ? toObjectId(phaseId) : null;
  let block = null;
  if (phase && !await ProjectPhase.exists({ companyId: ctx.companyId, projectId, _id: phase })) {
    throw badRequest("Phase does not belong to this project");
  }
  if (blockId) {
    const b = await Block.findOne({ companyId: ctx.companyId, projectId, _id: toObjectId(blockId) }).select("phaseId").lean();
    if (!b) throw badRequest("Block does not belong to this project");
    if (phase && b.phaseId && String(b.phaseId) !== String(phase)) throw badRequest("Block belongs to a different phase");
    block = b._id;
    phase = phase ?? b.phaseId ?? null;
  }
  return { phaseId: phase, blockId: block };
}
async function recordPlotStatus(ctx, entry, session) {
  await PlotStatusHistory.create([{ companyId: ctx.companyId, actorId: ctx.userId, ...entry }], { session });
}
async function listPlots(ctx, projectId, q) {
  await requireProject(ctx, projectId);
  const filter = { companyId: ctx.companyId, projectId: toObjectId(projectId), deletedAt: null };
  if (q.status) filter.status = q.status;
  if (q.phaseId) filter.phaseId = toObjectId(q.phaseId);
  if (q.blockId) filter.blockId = toObjectId(q.blockId);
  if (q.category) filter.category = q.category;
  if (q.unitType) filter.unitType = q.unitType;
  if (q.q) filter.plotNumber = new RegExp(escapeRegex(q.q.toUpperCase()));
  let sort = parseSort(q.sort, ["plotNumber", "areaX100", "listPricePaise", "status", "createdAt", "ratePaisePerSqft"], {
    plotNumber: 1
  });
  if (sort.plotNumber) sort = { blockId: sort.plotNumber, plotNumber: sort.plotNumber, _id: sort.plotNumber };
  const [items, total, blocks] = await Promise.all([
    Plot.find(filter).collation({ locale: "en", numericOrdering: true }).sort(sort).skip((q.page - 1) * q.pageSize).limit(q.pageSize).select("-mapShape").lean(),
    Plot.countDocuments(filter),
    Block.find({ companyId: ctx.companyId, projectId: toObjectId(projectId) }).select("code name").lean()
  ]);
  const blockCode = new Map(blocks.map((b) => [String(b._id), b.code]));
  return {
    items: items.map((p) => ({ ...p, id: String(p._id), blockCode: p.blockId ? blockCode.get(String(p.blockId)) : void 0 })),
    meta: pageMeta(q.page, q.pageSize, total)
  };
}
async function getPlot(ctx, projectId, plotId) {
  await requireProject(ctx, projectId);
  const plot = await Plot.findOne({ companyId: ctx.companyId, projectId: toObjectId(projectId), _id: toObjectId(plotId) }).lean();
  if (!plot) throw notFound("Plot");
  const [history, booking, block] = await Promise.all([
    PlotStatusHistory.find({ companyId: ctx.companyId, plotId: plot._id }).sort({ createdAt: -1 }).limit(50).populate("actorId", "name").lean(),
    plot.currentBookingId ? Booking.findOne({ companyId: ctx.companyId, _id: plot.currentBookingId }).select("bookingNumber status customerId netAmountPaise allocatedPaise reservedUntil").populate({ path: "customerId", select: "name phone customerCode", match: { companyId: ctx.companyId } }).lean() : null,
    plot.blockId ? Block.findOne({ companyId: ctx.companyId, _id: plot.blockId }).select("code name").lean() : null
  ]);
  return { ...plot, id: String(plot._id), blockCode: block?.code, history, currentBooking: booking };
}
async function createPlot(ctx, projectId, input) {
  const project = await requireProject(ctx, projectId);
  if (project.status === "archived") throw businessRule("Project is archived");
  const pid2 = toObjectId(projectId);
  const hierarchy = await resolveHierarchy(ctx, pid2, input.phaseId, input.blockId);
  return withTransaction(async (session) => {
    const [plot] = await Plot.create(
      [
        {
          companyId: ctx.companyId,
          projectId: pid2,
          ...input,
          ...hierarchy,
          listPricePaise: computeListPrice(input.areaX100, input.ratePaisePerSqft, input.plcBp),
          status: "available"
        }
      ],
      { session }
    );
    await recordPlotStatus(ctx, { projectId: pid2, plotId: plot._id, from: null, to: "available", reason: "Plot created" }, session);
    await audit(ctx, { action: "inventory.create", entityType: "plot", entityId: plot._id, summary: plot.plotNumber }, session);
    return plot.toJSON();
  });
}
async function bulkCreatePlots(ctx, projectId, input) {
  const project = await requireProject(ctx, projectId);
  if (project.status === "archived") throw businessRule("Project is archived");
  const pid2 = toObjectId(projectId);
  const hierarchy = await resolveHierarchy(ctx, pid2, input.phaseId, input.blockId);
  const listPricePaise = computeListPrice(input.areaX100, input.ratePaisePerSqft, input.plcBp);
  const docs = Array.from({ length: input.count }, (_, i) => ({
    _id: new Types7.ObjectId(),
    companyId: ctx.companyId,
    projectId: pid2,
    ...hierarchy,
    plotNumber: `${input.prefix}${input.startNumber + i}`,
    category: input.category,
    unitType: input.unitType,
    floor: input.floor,
    configuration: input.configuration,
    areaX100: input.areaX100,
    ratePaisePerSqft: input.ratePaisePerSqft,
    plcBp: input.plcBp,
    listPricePaise,
    status: "available"
  }));
  return withTransaction(async (session) => {
    await Plot.insertMany(docs, { session, ordered: true });
    await PlotStatusHistory.insertMany(
      docs.map((d) => ({
        companyId: ctx.companyId,
        projectId: pid2,
        plotId: d._id,
        from: null,
        to: "available",
        reason: "Bulk created",
        actorId: ctx.userId
      })),
      { session }
    );
    await audit(
      ctx,
      { action: "inventory.bulk_create", entityType: "project", entityId: pid2, summary: `${docs.length} plots created` },
      session
    );
    return { created: docs.length };
  });
}
var PRICE_FIELDS = ["areaX100", "ratePaisePerSqft", "plcBp"];
async function updatePlot(ctx, projectId, plotId, input) {
  await requireProject(ctx, projectId);
  const pid2 = toObjectId(projectId);
  const plot = await Plot.findOne({ companyId: ctx.companyId, projectId: pid2, _id: toObjectId(plotId) });
  if (!plot) throw notFound("Plot");
  const locked = !["available", "blocked"].includes(plot.status);
  const touchesCommercials = PRICE_FIELDS.some((f) => input[f] !== void 0) || input.plotNumber !== void 0 || input.blockId !== void 0;
  if (locked && touchesCommercials)
    throw businessRule("Area, rate, number and block cannot change while the plot is reserved, booked or sold");
  if (input.phaseId !== void 0 || input.blockId !== void 0) {
    const h = await resolveHierarchy(
      ctx,
      pid2,
      input.phaseId ?? (plot.phaseId ? String(plot.phaseId) : null),
      input.blockId ?? (plot.blockId ? String(plot.blockId) : null)
    );
    plot.phaseId = h.phaseId;
    plot.blockId = h.blockId;
  }
  const { phaseId: _p, blockId: _b, ...rest } = input;
  plot.set(rest);
  plot.listPricePaise = computeListPrice(plot.areaX100, plot.ratePaisePerSqft, plot.plcBp);
  await plot.save();
  await audit(ctx, { action: "inventory.update", entityType: "plot", entityId: plot._id, changes: input });
  return plot.toJSON();
}
async function changePlotStatus(ctx, projectId, plotId, to, reason) {
  await requireProject(ctx, projectId);
  const pid2 = toObjectId(projectId);
  return withTransaction(async (session) => {
    const plot = await Plot.findOne({ companyId: ctx.companyId, projectId: pid2, _id: toObjectId(plotId) }).session(session).lean();
    if (!plot) throw notFound("Plot");
    if (!MANUAL_PLOT_TRANSITIONS[plot.status].includes(to)) {
      throw businessRule(`Cannot change a ${plot.status} plot to ${to} manually`);
    }
    if (to === "sold") {
      const booking = await Booking.findOne({ companyId: ctx.companyId, _id: plot.currentBookingId }).session(session).lean();
      if (!booking || booking.status !== "booked") throw businessRule("Only plots with a confirmed booking can be marked sold");
      if (booking.allocatedPaise < booking.netAmountPaise)
        throw businessRule("The booking must be fully paid before the plot is marked sold");
    }
    const res = await Plot.updateOne(
      { companyId: ctx.companyId, _id: plot._id, status: plot.status },
      { $set: { status: to } },
      { session }
    );
    if (res.modifiedCount !== 1) throw businessRule("Plot status changed concurrently, please retry");
    await recordPlotStatus(
      ctx,
      { projectId: pid2, plotId: plot._id, from: plot.status, to, reason, bookingId: plot.currentBookingId ?? void 0 },
      session
    );
    await audit(
      ctx,
      { action: "inventory.status_change", entityType: "plot", entityId: plot._id, changes: { from: plot.status, to, reason } },
      session
    );
    return { id: String(plot._id), status: to };
  });
}
async function deletePlot(ctx, projectId, plotId) {
  await requireProject(ctx, projectId);
  const pid2 = toObjectId(projectId);
  const id = toObjectId(plotId);
  if (await BookingItem.exists({ companyId: ctx.companyId, plotId: id })) {
    throw businessRule("Plots that have ever been booked cannot be deleted; block them instead");
  }
  const res = await Plot.deleteOne({ companyId: ctx.companyId, projectId: pid2, _id: id, status: { $in: ["available", "blocked"] } });
  if (!res.deletedCount) throw notFound("Plot");
  await audit(ctx, { action: "inventory.delete", entityType: "plot", entityId: id });
}
async function getMapData(ctx, projectId) {
  const project = await requireProject(ctx, projectId);
  const plots = await Plot.find({ companyId: ctx.companyId, projectId: toObjectId(projectId), deletedAt: null }).select("plotNumber status mapShape areaX100 listPricePaise facing category unitType blockId isCorner").lean();
  const summary = {};
  for (const p of plots) summary[p.status] = (summary[p.status] ?? 0) + 1;
  return {
    map: project.map,
    summary,
    plots: plots.map((p) => ({
      id: String(p._id),
      plotNumber: p.plotNumber,
      status: p.status,
      points: p.mapShape?.points ?? null,
      areaX100: p.areaX100,
      listPricePaise: p.listPricePaise,
      facing: p.facing,
      category: p.category,
      isCorner: p.isCorner,
      blockId: p.blockId ? String(p.blockId) : null
    }))
  };
}
async function saveMapShapes(ctx, projectId, shapes) {
  await requireProject(ctx, projectId);
  const pid2 = toObjectId(projectId);
  const res = await Plot.bulkWrite(
    shapes.map((s) => ({
      updateOne: {
        filter: { companyId: ctx.companyId, projectId: pid2, _id: toObjectId(s.plotId) },
        update: s.points ? { $set: { "mapShape.points": s.points } } : { $unset: { mapShape: 1 } }
      }
    }))
  );
  await audit(ctx, { action: "map.edit", entityType: "project", entityId: pid2, summary: `${res.matchedCount} plot shapes saved` });
  return { matched: res.matchedCount, modified: res.modifiedCount };
}

// src/modules/reports/documents.service.ts
import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";

// src/modules/bookings/bookings.service.ts
import { Types as Types9 } from "mongoose";

// src/modules/brokers/brokers.service.ts
import { Types as Types8 } from "mongoose";
async function listBrokers(ctx, q, includeInactive = false) {
  const filter = { companyId: ctx.companyId };
  if (!includeInactive) filter.isActive = true;
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ name: rx }, { phone: rx }, { firmName: rx }];
  }
  const brokers = await Broker.find(filter).sort({ name: 1 }).lean();
  const sums = await BrokerCommission.aggregate([
    { $match: { companyId: ctx.companyId, brokerId: { $in: brokers.map((b) => b._id) } } },
    { $group: { _id: { b: "$brokerId", s: "$status" }, amount: { $sum: "$amountPaise" }, n: { $sum: 1 } } }
  ]);
  return brokers.map((b) => {
    const mine = sums.filter((s) => String(s._id.b) === String(b._id));
    const by = (s) => mine.find((m) => m._id.s === s)?.amount ?? 0;
    return {
      ...b,
      accruedPaise: by("accrued"),
      paidPaise: by("paid"),
      bookings: mine.filter((m) => m._id.s !== "cancelled").reduce((a, m) => a + m.n, 0)
    };
  });
}
async function getBroker(ctx, id) {
  const broker = await Broker.findOne({ companyId: ctx.companyId, _id: toObjectId(id) }).lean();
  if (!broker) throw notFound("Broker");
  const filter = { companyId: ctx.companyId, brokerId: broker._id };
  if (ctx.projectScope !== null) filter.projectId = { $in: ctx.projectScope };
  const commissions = await BrokerCommission.find(filter).sort({ createdAt: -1 }).populate({
    path: "bookingId",
    select: "bookingNumber status customerId",
    match: { companyId: ctx.companyId },
    populate: { path: "customerId", select: "name", match: { companyId: ctx.companyId } }
  }).populate({ path: "projectId", select: "name code", match: { companyId: ctx.companyId } }).lean();
  const payableBalancePaise = await partyBalance(ctx.companyId, { brokerId: broker._id }, "broker_payable");
  return { ...broker, commissions, payableBalancePaise };
}
async function createBroker(ctx, input) {
  const broker = await Broker.create({ companyId: ctx.companyId, ...input });
  await audit(ctx, { action: "brokers.create", entityType: "broker", entityId: broker._id, summary: broker.name });
  return broker.toJSON();
}
async function updateBroker(ctx, id, input) {
  const broker = await Broker.findOneAndUpdate(
    { companyId: ctx.companyId, _id: toObjectId(id) },
    { $set: input },
    { new: true, runValidators: true }
  ).lean();
  if (!broker) throw notFound("Broker");
  await audit(ctx, { action: "brokers.update", entityType: "broker", entityId: broker._id, changes: input });
  return broker;
}
async function accrueCommission(actor, bookingId, session) {
  const booking = await Booking.findOne({ companyId: actor.companyId, _id: bookingId }).session(session).lean();
  if (!booking?.brokerId || booking.status !== "booked") return null;
  if (await BrokerCommission.exists({ companyId: actor.companyId, bookingId }).session(session)) return null;
  const broker = await Broker.findOne({ companyId: actor.companyId, _id: booking.brokerId }).session(session).lean();
  if (!broker || !broker.commissionBp) return null;
  const basePaise = booking.grossAmountPaise - booking.discountPaise;
  const amountPaise = applyBasisPoints(basePaise, broker.commissionBp);
  if (amountPaise <= 0) return null;
  const commissionId = new Types8.ObjectId();
  const je = await postJournal(
    actor,
    {
      date: todayInIndia(),
      voucherType: "journal",
      narration: `Brokerage to ${broker.name} on booking ${booking.bookingNumber} @ ${broker.commissionBp / 100}%`,
      reference: booking.bookingNumber,
      projectId: booking.projectId,
      lines: [
        { systemKey: "brokerage_expense", debitPaise: amountPaise },
        { systemKey: "broker_payable", creditPaise: amountPaise, brokerId: broker._id, bookingId: booking._id }
      ],
      source: { type: "broker_commission", id: commissionId },
      allowControlAccounts: true
    },
    session
  );
  const [commission] = await BrokerCommission.create(
    [
      {
        _id: commissionId,
        companyId: actor.companyId,
        brokerId: broker._id,
        bookingId: booking._id,
        projectId: booking.projectId,
        basePaise,
        rateBp: broker.commissionBp,
        amountPaise,
        accrualJournalEntryId: je._id
      }
    ],
    { session }
  );
  return commission;
}
async function cancelCommission(actor, bookingId, reason, session) {
  const c = await BrokerCommission.findOne({ companyId: actor.companyId, bookingId, status: "accrued" }).session(session);
  if (!c) return;
  const rev = await reverseJournal(actor, c.accrualJournalEntryId, `Commission cancelled: ${reason}`, session, todayInIndia());
  const res = await BrokerCommission.updateOne(
    { companyId: actor.companyId, _id: c._id, status: "accrued" },
    { $set: { status: "cancelled", cancelJournalEntryId: rev._id } },
    { session }
  );
  if (res.modifiedCount !== 1) throw businessRule("Commission changed concurrently, please retry");
}
async function payoutCommissions(ctx, brokerId, input) {
  return withTransaction(async (session) => {
    const broker = await Broker.findOne({ companyId: ctx.companyId, _id: toObjectId(brokerId) }).session(session).lean();
    if (!broker) throw notFound("Broker");
    const ids = [...new Set(input.commissionIds)].map(toObjectId);
    const filter = { companyId: ctx.companyId, brokerId: broker._id, _id: { $in: ids }, status: "accrued" };
    if (ctx.projectScope !== null) filter.projectId = { $in: ctx.projectScope };
    const commissions = await BrokerCommission.find(filter).session(session).lean();
    if (commissions.length !== ids.length) throw businessRule("Some commissions are already paid, cancelled or not visible to you");
    const total = commissions.reduce((s, c) => s + c.amountPaise, 0);
    const accountId = await resolveCashAccountFor(ctx.companyId, input.fromAccountId, input.mode, session);
    const number = await nextDocumentNumber(ctx.companyId, "BPV", input.paidOn, session);
    const je = await postJournal(
      ctx,
      {
        date: input.paidOn,
        voucherType: "payment",
        narration: `Brokerage payout ${number} to ${broker.name} (${commissions.length} booking${commissions.length > 1 ? "s" : ""})`,
        reference: number,
        lines: [
          { systemKey: "broker_payable", debitPaise: total, brokerId: broker._id },
          { accountId, creditPaise: total }
        ],
        source: { type: "broker_payout", id: broker._id },
        allowControlAccounts: true
      },
      session
    );
    const res = await BrokerCommission.updateMany(
      { companyId: ctx.companyId, _id: { $in: ids }, status: "accrued" },
      {
        $set: {
          status: "paid",
          payout: {
            number,
            paidOn: parseISODate(input.paidOn),
            mode: input.mode,
            accountId,
            reference: input.reference,
            journalEntryId: je._id
          }
        }
      },
      { session }
    );
    if (res.modifiedCount !== ids.length) throw businessRule("Commissions changed concurrently, please retry");
    await audit(
      ctx,
      {
        action: "brokers.payout",
        entityType: "broker",
        entityId: broker._id,
        summary: `${number} ${formatINR(total)}`,
        changes: { commissionIds: ids.map(String) }
      },
      session
    );
    return { number, totalPaise: total, count: commissions.length, journalEntryId: String(je._id) };
  });
}

// src/modules/customers/customers.service.ts
function normalize(input) {
  const { dateOfBirth, ...rest } = input;
  return { ...rest, ...dateOfBirth ? { dateOfBirth: parseISODate(dateOfBirth) } : {} };
}
async function visibilityFilter(ctx) {
  const filter = { companyId: ctx.companyId, deletedAt: null };
  if (ctx.projectScope !== null) {
    const ids = await Booking.distinct("customerId", { companyId: ctx.companyId, projectId: { $in: ctx.projectScope } });
    filter.$or = [{ _id: { $in: ids } }, { createdBy: ctx.userId }];
  }
  return filter;
}
async function assertCustomerVisible(ctx, customerId) {
  const filter = await visibilityFilter(ctx);
  const customer = await Customer.findOne({ ...filter, _id: toObjectId(customerId) }).lean();
  if (!customer) throw notFound("Customer");
  return customer;
}
async function listCustomers(ctx, q) {
  const filter = await visibilityFilter(ctx);
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), "i");
    const search = { $or: [{ name: rx }, { phone: rx }, { customerCode: rx }, { email: rx }] };
    if (filter.$or) {
      filter.$and = [{ $or: filter.$or }, search];
      delete filter.$or;
    } else Object.assign(filter, search);
  }
  const sort = parseSort(q.sort, ["name", "customerCode", "createdAt"], { createdAt: -1 });
  const [items, total] = await Promise.all([
    Customer.find(filter).sort(sort).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(),
    Customer.countDocuments(filter)
  ]);
  return { items, meta: pageMeta(q.page, q.pageSize, total) };
}
async function getCustomer(ctx, id) {
  const customer = await assertCustomerVisible(ctx, id);
  const bookingFilter = { companyId: ctx.companyId, customerId: customer._id };
  if (ctx.projectScope !== null) bookingFilter.projectId = { $in: ctx.projectScope };
  const bookings = await Booking.find(bookingFilter).select("bookingNumber status projectId netAmountPaise allocatedPaise bookingDate").populate({ path: "projectId", select: "name code", match: { companyId: ctx.companyId } }).sort({ createdAt: -1 }).lean();
  return { ...customer, id: String(customer._id), bookings };
}
async function createCustomer(ctx, input) {
  return withTransaction(async (session) => {
    const seq = await nextSequence(ctx.companyId, "customer", session);
    const [customer] = await Customer.create(
      [{ companyId: ctx.companyId, customerCode: `C${String(seq).padStart(5, "0")}`, ...normalize(input), createdBy: ctx.userId }],
      { session }
    );
    await audit(ctx, { action: "customers.create", entityType: "customer", entityId: customer._id, summary: customer.name }, session);
    return customer.toJSON();
  });
}
async function updateCustomer(ctx, id, input) {
  await assertCustomerVisible(ctx, id);
  const customer = await Customer.findOneAndUpdate(
    { companyId: ctx.companyId, _id: toObjectId(id) },
    { $set: normalize(input) },
    { new: true, runValidators: true }
  ).lean();
  if (!customer) throw notFound("Customer");
  await audit(ctx, { action: "customers.update", entityType: "customer", entityId: customer._id, changes: input });
  return customer;
}
async function deleteCustomer(ctx, id) {
  const customer = await assertCustomerVisible(ctx, id);
  if (await Booking.exists({ companyId: ctx.companyId, customerId: customer._id })) {
    throw businessRule("Customers with bookings cannot be deleted");
  }
  await Customer.updateOne({ companyId: ctx.companyId, _id: customer._id }, { $set: { deletedAt: /* @__PURE__ */ new Date() } });
  await audit(ctx, { action: "customers.delete", entityType: "customer", entityId: customer._id });
}
async function customerLedger(ctx, id) {
  const customer = await assertCustomerVisible(ctx, id);
  const match = { companyId: ctx.companyId, "lines.customerId": customer._id };
  if (ctx.projectScope !== null) match.projectId = { $in: ctx.projectScope };
  const rows = await JournalEntry.aggregate([
    { $match: match },
    { $unwind: "$lines" },
    { $match: { "lines.customerId": customer._id } },
    { $sort: { date: 1, createdAt: 1, _id: 1 } },
    {
      $project: {
        entryNumber: 1,
        date: 1,
        narration: { $ifNull: ["$lines.narration", "$narration"] },
        voucherType: 1,
        debitPaise: "$lines.debitPaise",
        creditPaise: "$lines.creditPaise",
        bookingId: "$lines.bookingId"
      }
    }
  ]);
  let balance = 0;
  const entries = rows.map((r) => {
    balance += r.debitPaise - r.creditPaise;
    return { ...r, balancePaise: balance };
  });
  return {
    customer: { id: String(customer._id), name: customer.name, customerCode: customer.customerCode, phone: customer.phone },
    entries,
    totals: {
      debitPaise: rows.reduce((s, r) => s + r.debitPaise, 0),
      creditPaise: rows.reduce((s, r) => s + r.creditPaise, 0),
      balancePaise: balance
    }
  };
}

// src/modules/bookings/bookings.service.ts
async function loadPlan(ctx, planId, projectId, session) {
  const plan = await PaymentPlan.findOne({ companyId: ctx.companyId, _id: toObjectId(planId), isActive: true }).session(session ?? null).lean();
  if (!plan) throw badRequest("Payment plan not found or inactive");
  if (plan.projectId && String(plan.projectId) !== String(projectId)) throw badRequest("Payment plan is not available for this project");
  return plan;
}
async function priceBooking(ctx, input, session) {
  assertProjectAccess(ctx, input.projectId);
  const projectId = toObjectId(input.projectId);
  const project = await Project.findOne({ companyId: ctx.companyId, _id: projectId }).session(session ?? null).lean();
  if (!project) throw notFound("Project");
  if (project.status === "archived") throw businessRule("Project is archived");
  const plotIds = [...new Set(input.plotIds)].map(toObjectId);
  if (plotIds.length !== input.plotIds.length) throw badRequest("Duplicate plots selected");
  const plots = await Plot.find({ companyId: ctx.companyId, projectId, _id: { $in: plotIds }, deletedAt: null }).session(session ?? null).lean();
  if (plots.length !== plotIds.length) throw badRequest("One or more plots do not belong to this project");
  const blocks = await Block.find({ companyId: ctx.companyId, projectId }).session(session ?? null).select("code").lean();
  const blockCode = new Map(blocks.map((b) => [String(b._id), b.code]));
  const items = plots.map((p) => {
    const basePaise = priceForArea(p.areaX100, p.ratePaisePerSqft);
    const plcPaise = applyBasisPoints(basePaise, p.plcBp);
    return {
      plotId: p._id,
      plotNumber: p.plotNumber,
      blockCode: p.blockId ? blockCode.get(String(p.blockId)) : void 0,
      areaX100: p.areaX100,
      ratePaisePerSqft: p.ratePaisePerSqft,
      plcBp: p.plcBp,
      basePaise,
      plcPaise,
      lineTotalPaise: basePaise + plcPaise
    };
  });
  const grossAmountPaise = items.reduce((s, i) => s + i.lineTotalPaise, 0);
  const chargesTotalPaise = input.charges.reduce((s, c) => s + c.amountPaise, 0);
  if (input.discountPaise > grossAmountPaise) throw businessRule("Discount cannot exceed the plot value");
  const netAmountPaise = grossAmountPaise - input.discountPaise + chargesTotalPaise;
  if (netAmountPaise <= 0) throw businessRule("Booking amount must be greater than zero");
  const plan = await loadPlan(ctx, input.paymentPlanId, projectId, session);
  const schedule = generateSchedule(plan.rules, netAmountPaise, input.bookingDate);
  return {
    project,
    plots,
    items,
    plan,
    schedule,
    grossAmountPaise,
    chargesTotalPaise,
    netAmountPaise,
    discountPaise: input.discountPaise,
    charges: input.charges
  };
}
async function quote(ctx, input) {
  const priced = await priceBooking(ctx, input);
  return {
    items: priced.items,
    unavailable: priced.plots.filter((p) => p.status !== "available").map((p) => ({ plotNumber: p.plotNumber, status: p.status })),
    grossAmountPaise: priced.grossAmountPaise,
    discountPaise: priced.discountPaise,
    charges: priced.charges,
    chargesTotalPaise: priced.chargesTotalPaise,
    netAmountPaise: priced.netAmountPaise,
    schedule: priced.schedule,
    planName: priced.plan.name
  };
}
async function createBooking(ctx, input) {
  if (input.discountPaise > 0 && !hasPermission(ctx, "bookings.discount")) throw forbidden("You are not allowed to give discounts");
  await assertCustomerVisible(ctx, input.customerId);
  const company = await Company.findById(ctx.companyId).select("settings").lean();
  try {
    return await withTransaction(async (session) => {
      const priced = await priceBooking(ctx, input, session);
      const projectId = priced.project._id;
      const customer = await Customer.findOne({ companyId: ctx.companyId, _id: toObjectId(input.customerId), deletedAt: null }).session(session).lean();
      if (!customer) throw badRequest("Customer not found");
      if (input.brokerId && !await Broker.exists({ companyId: ctx.companyId, _id: toObjectId(input.brokerId) }).session(session)) {
        throw badRequest("Broker not found");
      }
      const unavailable = priced.plots.filter((p) => p.status !== "available");
      if (unavailable.length) {
        throw new AppError(409, "CONFLICT", `Plot ${unavailable.map((p) => p.plotNumber).join(", ")} is no longer available`);
      }
      const quotationId = input.quotationId ? toObjectId(input.quotationId) : void 0;
      const status = input.mode === "reserve" ? "reserved" : "booked";
      const plotStatus = status === "reserved" ? "reserved" : "booked";
      const bookingId = new Types9.ObjectId();
      for (const plot of priced.plots) {
        const claimed = await Plot.updateOne(
          { companyId: ctx.companyId, _id: plot._id, status: "available" },
          { $set: { status: plotStatus, currentBookingId: bookingId } },
          { session }
        );
        if (claimed.modifiedCount !== 1) throw new AppError(409, "CONFLICT", `Plot ${plot.plotNumber} was just booked by someone else`);
      }
      const fy = financialYear(input.bookingDate);
      const seq = await nextSequence(ctx.companyId, `booking:${fy}`, session);
      const bookingNumber = `${company?.settings?.bookingPrefix ?? "BKG"}/${fy}/${String(seq).padStart(5, "0")}`;
      const holdHours = input.reservationHours ?? company?.settings?.reservationHoldHours ?? 72;
      const salesJe = await postJournal(
        ctx,
        {
          date: input.bookingDate,
          voucherType: "sales",
          narration: `Booking ${bookingNumber} \u2013 ${customer.name} \u2013 plots ${priced.items.map((i) => i.plotNumber).join(", ")}`,
          reference: bookingNumber,
          projectId,
          lines: [
            { systemKey: "customer_receivable", debitPaise: priced.netAmountPaise, customerId: customer._id, bookingId },
            { systemKey: "plot_sales", creditPaise: priced.grossAmountPaise - priced.discountPaise },
            { systemKey: "other_income", creditPaise: priced.chargesTotalPaise, narration: "Booking charges" }
          ],
          source: { type: "booking", id: bookingId },
          allowControlAccounts: true
        },
        session
      );
      const [booking] = await Booking.create(
        [
          {
            _id: bookingId,
            companyId: ctx.companyId,
            projectId,
            bookingNumber,
            customerId: customer._id,
            brokerId: input.brokerId ? toObjectId(input.brokerId) : void 0,
            paymentPlanId: priced.plan._id,
            planSnapshot: { name: priced.plan.name, rules: priced.plan.rules },
            status,
            bookingDate: parseISODate(input.bookingDate),
            reservedUntil: status === "reserved" ? new Date(Date.now() + holdHours * 36e5) : void 0,
            confirmedAt: status === "booked" ? /* @__PURE__ */ new Date() : void 0,
            grossAmountPaise: priced.grossAmountPaise,
            discountPaise: priced.discountPaise,
            charges: priced.charges,
            chargesTotalPaise: priced.chargesTotalPaise,
            netAmountPaise: priced.netAmountPaise,
            salesJournalEntryId: salesJe._id,
            quotationId,
            remarks: input.remarks,
            createdBy: ctx.userId
          }
        ],
        { session }
      );
      await BookingItem.insertMany(
        priced.items.map((i) => ({ companyId: ctx.companyId, projectId, bookingId, ...i, active: true })),
        { session }
      );
      await Installment.insertMany(
        priced.schedule.map((s) => ({
          companyId: ctx.companyId,
          projectId,
          bookingId,
          customerId: customer._id,
          sequence: s.sequence,
          name: s.name,
          dueDate: parseISODate(s.dueDate),
          amountPaise: s.amountPaise
        })),
        { session }
      );
      for (const plot of priced.plots) {
        await recordPlotStatus(
          ctx,
          { projectId, plotId: plot._id, from: "available", to: plotStatus, reason: `Booking ${bookingNumber}`, bookingId },
          session
        );
      }
      await audit(
        ctx,
        {
          action: status === "reserved" ? "bookings.reserve" : "bookings.create",
          entityType: "booking",
          entityId: bookingId,
          summary: `${bookingNumber} for ${customer.name}`,
          changes: {
            plots: priced.items.map((i) => i.plotNumber),
            netAmountPaise: priced.netAmountPaise,
            discountPaise: priced.discountPaise
          }
        },
        session
      );
      if (quotationId) {
        const converted = await Quotation.updateOne(
          { companyId: ctx.companyId, _id: quotationId, projectId, status: { $in: ["draft", "sent", "accepted"] } },
          { $set: { status: "converted", bookingId, customerId: customer._id } },
          { session }
        );
        if (converted.modifiedCount !== 1) throw businessRule("This quotation has already been converted, cancelled or expired");
      }
      if (status === "booked") await accrueCommission(ctx, bookingId, session);
      return booking.toJSON();
    });
  } catch (err) {
    if (err.code === 11e3 && err.keyPattern?.plotId) {
      throw new AppError(409, "CONFLICT", "One of the selected plots was just booked by someone else");
    }
    throw err;
  }
}
async function listBookings(ctx, q, projectId) {
  const filter = scopedFilter(ctx, projectId);
  if (q.status) filter.status = q.status;
  if (q.customerId) filter.customerId = toObjectId(q.customerId);
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), "i");
    const customers = await Customer.find({ companyId: ctx.companyId, $or: [{ name: rx }, { phone: rx }] }).select("_id").limit(200).lean();
    filter.$or = [{ bookingNumber: rx }, { customerId: { $in: customers.map((c) => c._id) } }];
  }
  const sort = parseSort(q.sort, ["bookingNumber", "bookingDate", "netAmountPaise", "createdAt", "status"], { createdAt: -1 });
  const [items, total] = await Promise.all([
    Booking.find(filter).sort(sort).skip((q.page - 1) * q.pageSize).limit(q.pageSize).select("-planSnapshot").populate({ path: "customerId", select: "name phone customerCode", match: { companyId: ctx.companyId } }).populate({ path: "projectId", select: "name code", match: { companyId: ctx.companyId } }).lean(),
    Booking.countDocuments(filter)
  ]);
  const itemRows = await BookingItem.find({ companyId: ctx.companyId, bookingId: { $in: items.map((b) => b._id) } }).select("bookingId plotNumber blockCode").lean();
  return {
    items: items.map((b) => ({
      ...b,
      id: String(b._id),
      plots: itemRows.filter((i) => String(i.bookingId) === String(b._id)).map((i) => i.blockCode ? `${i.blockCode}-${i.plotNumber}` : i.plotNumber)
    })),
    meta: pageMeta(q.page, q.pageSize, total)
  };
}
async function getBooking(ctx, id) {
  const booking = await Booking.findOne({ companyId: ctx.companyId, _id: toObjectId(id) }).populate({ path: "customerId", match: { companyId: ctx.companyId } }).populate({ path: "projectId", select: "name code address reraNumber", match: { companyId: ctx.companyId } }).populate({ path: "brokerId", select: "name phone", match: { companyId: ctx.companyId } }).lean();
  if (!booking) throw notFound("Booking");
  const projectId = booking.projectId?._id ?? booking.projectId;
  assertProjectAccess(ctx, projectId);
  const [items, installments, payments] = await Promise.all([
    BookingItem.find({ companyId: ctx.companyId, bookingId: booking._id }).lean(),
    Installment.find({ companyId: ctx.companyId, bookingId: booking._id }).sort({ sequence: 1 }).lean(),
    Payment.find({ companyId: ctx.companyId, bookingId: booking._id }).sort({ createdAt: 1 }).lean()
  ]);
  const today = parseISODate(todayInIndia());
  const enriched = installments.map((i) => ({
    ...i,
    id: String(i._id),
    balancePaise: i.amountPaise - i.paidPaise,
    overdue: i.status !== "cancelled" && i.paidPaise < i.amountPaise && i.dueDate < today
  }));
  const overduePaise = enriched.filter((i) => i.overdue).reduce((s, i) => s + i.balancePaise, 0);
  return {
    ...booking,
    id: String(booking._id),
    items,
    installments: enriched,
    payments,
    summary: {
      netAmountPaise: booking.netAmountPaise,
      receivedPaise: booking.receivedPaise,
      allocatedPaise: booking.allocatedPaise,
      advancePaise: booking.advancePaise,
      outstandingPaise: booking.status === "cancelled" || booking.status === "expired" ? 0 : booking.netAmountPaise - booking.allocatedPaise,
      overduePaise,
      refundablePaise: booking.refundablePaise,
      refundedPaise: booking.refundedPaise
    }
  };
}
async function confirmBooking(ctx, id) {
  return withTransaction(async (session) => {
    const booking = await Booking.findOne({ companyId: ctx.companyId, _id: toObjectId(id) }).session(session).lean();
    if (!booking) throw notFound("Booking");
    assertProjectAccess(ctx, booking.projectId);
    if (!canTransitionBooking(booking.status, "booked")) throw businessRule(`A ${booking.status} booking cannot be confirmed`);
    if (booking.reservedUntil && booking.reservedUntil < /* @__PURE__ */ new Date()) throw businessRule("This reservation has expired");
    const res = await Booking.updateOne(
      { companyId: ctx.companyId, _id: booking._id, status: "reserved" },
      { $set: { status: "booked", confirmedAt: /* @__PURE__ */ new Date() }, $unset: { reservedUntil: 1 } },
      { session }
    );
    if (res.modifiedCount !== 1) throw businessRule("Booking changed concurrently, please retry");
    const items = await BookingItem.find({ companyId: ctx.companyId, bookingId: booking._id, active: true }).session(session).lean();
    for (const item of items) {
      const upd = await Plot.updateOne(
        { companyId: ctx.companyId, _id: item.plotId, status: "reserved", currentBookingId: booking._id },
        { $set: { status: "booked" } },
        { session }
      );
      if (upd.modifiedCount !== 1) throw businessRule(`Plot ${item.plotNumber} is not held by this reservation`);
      await recordPlotStatus(
        ctx,
        {
          projectId: booking.projectId,
          plotId: item.plotId,
          from: "reserved",
          to: "booked",
          reason: `Booking ${booking.bookingNumber} confirmed`,
          bookingId: booking._id
        },
        session
      );
    }
    await audit(ctx, { action: "bookings.confirm", entityType: "booking", entityId: booking._id, summary: booking.bookingNumber }, session);
    await accrueCommission(ctx, booking._id, session);
    return { id: String(booking._id), status: "booked" };
  });
}
async function closeBooking(actor, bookingId, to, input, session, projectGuard) {
  const booking = await Booking.findOne({ companyId: actor.companyId, _id: bookingId }).session(session).lean();
  if (!booking) throw notFound("Booking");
  projectGuard?.(booking.projectId);
  if (!canTransitionBooking(booking.status, to)) throw businessRule(`A ${booking.status} booking cannot be ${to}`);
  if (input.cancellationChargePaise > booking.receivedPaise) {
    throw businessRule("Cancellation charges cannot exceed the amount received");
  }
  const refundable = booking.receivedPaise - input.cancellationChargePaise;
  const res = await Booking.updateOne(
    { companyId: actor.companyId, _id: booking._id, status: booking.status, receivedPaise: booking.receivedPaise },
    {
      $set: {
        status: to,
        closedAt: /* @__PURE__ */ new Date(),
        refundablePaise: refundable,
        cancellation: { reason: input.reason, chargePaise: input.cancellationChargePaise, by: actor.userId }
      }
    },
    { session }
  );
  if (res.modifiedCount !== 1) throw businessRule("Booking changed concurrently, please retry");
  const today = todayInIndia();
  const journalIds = [];
  if (booking.salesJournalEntryId) {
    const rev = await reverseJournal(actor, booking.salesJournalEntryId, `Booking ${booking.bookingNumber} ${to}`, session, today);
    journalIds.push(rev._id);
  }
  const adjustments = await LedgerAdjustment.find({ companyId: actor.companyId, bookingId: booking._id, status: "posted" }).session(session).lean();
  for (const adj of adjustments) {
    if (!adj.journalEntryId) continue;
    const rev = await reverseJournal(actor, adj.journalEntryId, `Booking ${booking.bookingNumber} ${to}`, session, today);
    journalIds.push(rev._id);
    await LedgerAdjustment.updateOne(
      { companyId: actor.companyId, _id: adj._id },
      { $set: { status: "reversed", reversal: { at: /* @__PURE__ */ new Date(), by: actor.userId, reason: `Booking ${to}`, journalEntryId: rev._id } } },
      { session }
    );
  }
  if (booking.receivedPaise > 0) {
    const reclass = await postJournal(
      actor,
      {
        date: today,
        voucherType: "journal",
        narration: `Booking ${booking.bookingNumber} ${to}: amount received transferred to refunds payable`,
        reference: booking.bookingNumber,
        projectId: booking.projectId,
        lines: [
          { systemKey: "customer_receivable", debitPaise: booking.allocatedPaise, customerId: booking.customerId, bookingId: booking._id },
          { systemKey: "customer_advance", debitPaise: booking.advancePaise, customerId: booking.customerId, bookingId: booking._id },
          { systemKey: "refund_payable", creditPaise: refundable, customerId: booking.customerId, bookingId: booking._id },
          { systemKey: "cancellation_income", creditPaise: input.cancellationChargePaise, narration: "Cancellation charges retained" }
        ],
        source: { type: "booking_cancellation", id: booking._id },
        allowControlAccounts: true
      },
      session
    );
    journalIds.push(reclass._id);
  }
  await Booking.updateOne(
    { companyId: actor.companyId, _id: booking._id },
    { $set: { "cancellation.journalEntryIds": journalIds } },
    { session }
  );
  await Installment.updateMany({ companyId: actor.companyId, bookingId: booking._id }, { $set: { status: "cancelled" } }, { session });
  await ParkingSlot.updateMany(
    { companyId: actor.companyId, bookingId: booking._id, status: "allotted" },
    {
      $set: { status: "available", bookingId: null, customerId: null, allottedAt: null },
      $push: { history: { action: "released", bookingId: booking._id, note: `Booking ${to}`, by: actor.userId } }
    },
    { session }
  );
  await cancelCommission(actor, booking._id, `Booking ${booking.bookingNumber} ${to}`, session);
  const items = await BookingItem.find({ companyId: actor.companyId, bookingId: booking._id, active: true }).session(session).lean();
  await BookingItem.updateMany(
    { companyId: actor.companyId, bookingId: booking._id, active: true },
    { $set: { active: false } },
    { session }
  );
  for (const item of items) {
    const plot = await Plot.findOneAndUpdate(
      { companyId: actor.companyId, _id: item.plotId, currentBookingId: booking._id, status: { $in: ["reserved", "booked"] } },
      { $set: { status: "available", currentBookingId: null } },
      { session }
    ).lean();
    if (plot) {
      await recordPlotStatus(
        actor,
        {
          projectId: booking.projectId,
          plotId: item.plotId,
          from: plot.status,
          to: "available",
          reason: `Booking ${booking.bookingNumber} ${to}: ${input.reason}`,
          bookingId: booking._id
        },
        session
      );
    }
  }
  await audit(
    actor,
    {
      action: to === "expired" ? "bookings.expire" : "bookings.cancel",
      entityType: "booking",
      entityId: booking._id,
      summary: booking.bookingNumber,
      changes: { reason: input.reason, cancellationChargePaise: input.cancellationChargePaise, refundablePaise: refundable }
    },
    session
  );
  return { id: String(booking._id), status: to, refundablePaise: refundable };
}
async function cancelBooking(ctx, id, input) {
  return withTransaction(
    (session) => closeBooking(ctx, toObjectId(id), "cancelled", input, session, (pid2) => assertProjectAccess(ctx, pid2))
  );
}

// src/modules/payments/payments.service.ts
import { Types as Types10 } from "mongoose";
function installmentStatus(amount, paid) {
  if (paid >= amount) return "paid";
  return paid > 0 ? "partial" : "pending";
}
function resolveCashAccount(ctx, accountId, mode, session) {
  return resolveCashAccountFor(ctx.companyId, accountId, mode, session);
}
async function recordPayment(ctx, input) {
  const company = await Company.findById(ctx.companyId).select("settings").lean();
  const policy = company?.settings?.overpaymentPolicy ?? "advance";
  return withTransaction(async (session) => {
    const booking = await Booking.findOne({ companyId: ctx.companyId, _id: toObjectId(input.bookingId) }).session(session).lean();
    if (!booking) throw notFound("Booking");
    assertProjectAccess(ctx, booking.projectId);
    if (booking.status !== "reserved" && booking.status !== "booked") {
      throw businessRule(`Payments cannot be recorded against a ${booking.status} booking`);
    }
    const accountId = await resolveCashAccount(ctx, input.depositAccountId, input.mode, session);
    const open = await Installment.find({ companyId: ctx.companyId, bookingId: booking._id, status: { $in: ["pending", "partial"] } }).sort({ dueDate: 1, sequence: 1 }).session(session).lean();
    let remaining = input.amountPaise;
    const allocations = [];
    for (const inst of open) {
      if (remaining === 0) break;
      const balance = inst.amountPaise - inst.paidPaise;
      if (balance <= 0) continue;
      const take = Math.min(balance, remaining);
      const newPaid = inst.paidPaise + take;
      const upd = await Installment.updateOne(
        { companyId: ctx.companyId, _id: inst._id, paidPaise: inst.paidPaise },
        { $set: { paidPaise: newPaid, status: installmentStatus(inst.amountPaise, newPaid) } },
        { session }
      );
      if (upd.modifiedCount !== 1) throw businessRule("Installment changed concurrently, please retry");
      allocations.push({ installmentId: inst._id, amountPaise: take });
      remaining -= take;
    }
    const allocated = input.amountPaise - remaining;
    if (remaining > 0 && policy === "reject") {
      throw businessRule(`Amount exceeds the outstanding balance by ${formatINR(remaining)}`);
    }
    const fy = financialYear(input.receivedOn);
    const seq = await nextSequence(ctx.companyId, `receipt:${fy}`, session);
    const number = `${company?.settings?.receiptPrefix ?? "RCPT"}/${fy}/${String(seq).padStart(6, "0")}`;
    const paymentId = new Types10.ObjectId();
    const je = await postJournal(
      ctx,
      {
        date: input.receivedOn,
        voucherType: "receipt",
        narration: `Receipt ${number} against booking ${booking.bookingNumber} (${input.mode}${input.reference ? ` ${input.reference}` : ""})`,
        reference: number,
        projectId: booking.projectId,
        lines: [
          { accountId, debitPaise: input.amountPaise },
          { systemKey: "customer_receivable", creditPaise: allocated, customerId: booking.customerId, bookingId: booking._id },
          {
            systemKey: "customer_advance",
            creditPaise: remaining,
            customerId: booking.customerId,
            bookingId: booking._id,
            narration: "Excess held as advance"
          }
        ],
        source: { type: "payment", id: paymentId },
        allowControlAccounts: true
      },
      session
    );
    const [payment] = await Payment.create(
      [
        {
          _id: paymentId,
          companyId: ctx.companyId,
          projectId: booking.projectId,
          bookingId: booking._id,
          customerId: booking.customerId,
          kind: "receipt",
          number,
          amountPaise: input.amountPaise,
          allocatedPaise: allocated,
          advancePaise: remaining,
          mode: input.mode,
          reference: input.reference,
          bankName: input.bankName,
          date: parseISODate(input.receivedOn),
          accountId,
          journalEntryId: je._id,
          remarks: input.remarks,
          createdBy: ctx.userId
        }
      ],
      { session }
    );
    if (allocations.length) {
      await PaymentAllocation.insertMany(
        allocations.map((a) => ({ companyId: ctx.companyId, paymentId, bookingId: booking._id, ...a })),
        { session }
      );
    }
    const totals = await Booking.updateOne(
      { companyId: ctx.companyId, _id: booking._id, status: booking.status },
      { $inc: { receivedPaise: input.amountPaise, allocatedPaise: allocated, advancePaise: remaining } },
      { session }
    );
    if (totals.modifiedCount !== 1) throw businessRule("Booking changed concurrently, please retry");
    await audit(
      ctx,
      {
        action: "payments.create",
        entityType: "payment",
        entityId: paymentId,
        summary: `${number} ${formatINR(input.amountPaise)} for ${booking.bookingNumber}`,
        changes: {
          allocations: allocations.map((a) => ({ installmentId: String(a.installmentId), amountPaise: a.amountPaise })),
          advancePaise: remaining
        }
      },
      session
    );
    return payment.toJSON();
  });
}
async function reversePayment(ctx, id, reason) {
  return withTransaction(async (session) => {
    const payment = await Payment.findOne({ companyId: ctx.companyId, _id: toObjectId(id) }).session(session).lean();
    if (!payment) throw notFound("Payment");
    assertProjectAccess(ctx, payment.projectId);
    if (payment.kind !== "receipt") throw businessRule("Only receipts can be reversed");
    if (payment.status !== "received") throw businessRule("This receipt has already been reversed");
    const booking = await Booking.findOne({ companyId: ctx.companyId, _id: payment.bookingId }).session(session).lean();
    if (!booking || booking.status !== "reserved" && booking.status !== "booked") {
      throw businessRule("Receipts of cancelled or expired bookings cannot be reversed; adjust the refund instead");
    }
    const marked = await Payment.updateOne(
      { companyId: ctx.companyId, _id: payment._id, status: "received" },
      { $set: { status: "reversed", reversal: { reason, at: /* @__PURE__ */ new Date(), by: ctx.userId } } },
      { session }
    );
    if (marked.modifiedCount !== 1) throw businessRule("This receipt has already been reversed");
    const allocations = await PaymentAllocation.find({ companyId: ctx.companyId, paymentId: payment._id, reversedAt: null }).session(session).lean();
    for (const a of allocations) {
      const inst = await Installment.findOne({ companyId: ctx.companyId, _id: a.installmentId }).session(session).lean();
      if (!inst) throw new Error("Allocation references a missing installment");
      const newPaid = inst.paidPaise - a.amountPaise;
      if (newPaid < 0) throw new Error("Allocation exceeds installment paid amount");
      const upd = await Installment.updateOne(
        { companyId: ctx.companyId, _id: inst._id, paidPaise: inst.paidPaise },
        { $set: { paidPaise: newPaid, status: installmentStatus(inst.amountPaise, newPaid) } },
        { session }
      );
      if (upd.modifiedCount !== 1) throw businessRule("Installment changed concurrently, please retry");
    }
    await PaymentAllocation.updateMany(
      { companyId: ctx.companyId, paymentId: payment._id, reversedAt: null },
      { $set: { reversedAt: /* @__PURE__ */ new Date() } },
      { session }
    );
    const rev = await reverseJournal(
      ctx,
      payment.journalEntryId,
      `Receipt ${payment.number} reversed: ${reason}`,
      session,
      todayInIndia()
    );
    await Payment.updateOne({ companyId: ctx.companyId, _id: payment._id }, { $set: { "reversal.journalEntryId": rev._id } }, { session });
    const totals = await Booking.updateOne(
      { companyId: ctx.companyId, _id: booking._id, status: booking.status, advancePaise: { $gte: payment.advancePaise } },
      { $inc: { receivedPaise: -payment.amountPaise, allocatedPaise: -payment.allocatedPaise, advancePaise: -payment.advancePaise } },
      { session }
    );
    if (totals.modifiedCount !== 1) throw businessRule("Booking changed concurrently, please retry");
    await audit(
      ctx,
      { action: "payments.reverse", entityType: "payment", entityId: payment._id, summary: payment.number, changes: { reason } },
      session
    );
    return { id: String(payment._id), status: "reversed" };
  });
}
async function refundBooking(ctx, bookingId, input) {
  return withTransaction(async (session) => {
    const booking = await Booking.findOne({ companyId: ctx.companyId, _id: toObjectId(bookingId) }).session(session).lean();
    if (!booking) throw notFound("Booking");
    assertProjectAccess(ctx, booking.projectId);
    if (booking.status !== "cancelled" && booking.status !== "expired")
      throw businessRule("Refunds are only possible for cancelled bookings");
    if (input.amountPaise > booking.refundablePaise) {
      throw businessRule(`Refund exceeds the refundable balance of ${formatINR(booking.refundablePaise)}`);
    }
    const accountId = await resolveCashAccount(ctx, input.fromAccountId, input.mode, session);
    const fy = financialYear(input.paidOn);
    const seq = await nextSequence(ctx.companyId, `refund:${fy}`, session);
    const number = `RFD/${fy}/${String(seq).padStart(6, "0")}`;
    const paymentId = new Types10.ObjectId();
    const je = await postJournal(
      ctx,
      {
        date: input.paidOn,
        voucherType: "payment",
        narration: `Refund ${number} for cancelled booking ${booking.bookingNumber}`,
        reference: number,
        projectId: booking.projectId,
        lines: [
          { systemKey: "refund_payable", debitPaise: input.amountPaise, customerId: booking.customerId, bookingId: booking._id },
          { accountId, creditPaise: input.amountPaise }
        ],
        source: { type: "refund", id: paymentId },
        allowControlAccounts: true
      },
      session
    );
    const upd = await Booking.updateOne(
      { companyId: ctx.companyId, _id: booking._id, refundablePaise: { $gte: input.amountPaise } },
      { $inc: { refundablePaise: -input.amountPaise, refundedPaise: input.amountPaise } },
      { session }
    );
    if (upd.modifiedCount !== 1) throw businessRule("Refundable balance changed concurrently, please retry");
    const [refund] = await Payment.create(
      [
        {
          _id: paymentId,
          companyId: ctx.companyId,
          projectId: booking.projectId,
          bookingId: booking._id,
          customerId: booking.customerId,
          kind: "refund",
          number,
          amountPaise: input.amountPaise,
          mode: input.mode,
          reference: input.reference,
          date: parseISODate(input.paidOn),
          accountId,
          journalEntryId: je._id,
          remarks: input.remarks,
          createdBy: ctx.userId
        }
      ],
      { session }
    );
    await audit(
      ctx,
      {
        action: "payments.refund",
        entityType: "payment",
        entityId: paymentId,
        summary: `${number} ${formatINR(input.amountPaise)} for ${booking.bookingNumber}`
      },
      session
    );
    return refund.toJSON();
  });
}
async function listPayments(ctx, q, projectId) {
  const filter = scopedFilter(ctx, projectId);
  if (q.bookingId) filter.bookingId = toObjectId(q.bookingId);
  if (q.customerId) filter.customerId = toObjectId(q.customerId);
  if (q.kind) filter.kind = q.kind;
  if (q.from || q.to) filter.date = { ...q.from ? { $gte: parseISODate(q.from) } : {}, ...q.to ? { $lte: parseISODate(q.to) } : {} };
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), "i");
    const customers = await Customer.find({ companyId: ctx.companyId, $or: [{ name: rx }, { phone: rx }] }).select("_id").limit(200).lean();
    filter.$or = [{ number: rx }, { reference: rx }, { customerId: { $in: customers.map((c) => c._id) } }];
  }
  const sort = parseSort(q.sort, ["date", "amountPaise", "number", "createdAt"], { createdAt: -1 });
  const [items, total] = await Promise.all([
    Payment.find(filter).sort(sort).skip((q.page - 1) * q.pageSize).limit(q.pageSize).populate({ path: "customerId", select: "name phone customerCode", match: { companyId: ctx.companyId } }).populate({ path: "bookingId", select: "bookingNumber", match: { companyId: ctx.companyId } }).lean(),
    Payment.countDocuments(filter)
  ]);
  return { items, meta: pageMeta(q.page, q.pageSize, total) };
}
async function getPayment(ctx, id) {
  const payment = await Payment.findOne({ companyId: ctx.companyId, _id: toObjectId(id) }).populate({ path: "customerId", match: { companyId: ctx.companyId } }).populate({ path: "bookingId", select: "bookingNumber netAmountPaise allocatedPaise status", match: { companyId: ctx.companyId } }).populate({ path: "projectId", select: "name code address", match: { companyId: ctx.companyId } }).populate({ path: "accountId", select: "name code", match: { companyId: ctx.companyId } }).lean();
  if (!payment) throw notFound("Payment");
  const pid2 = payment.projectId?._id ?? payment.projectId;
  assertProjectAccess(ctx, pid2);
  const allocations = await PaymentAllocation.find({ companyId: ctx.companyId, paymentId: payment._id }).populate({ path: "installmentId", select: "name sequence dueDate amountPaise", match: { companyId: ctx.companyId } }).lean();
  return { ...payment, id: String(payment._id), allocations };
}

// src/modules/reports/documents.service.ts
var rs = (paise2) => `Rs. ${formatINR(paise2, { symbol: false })}`;
function pdfResponse(res, filename) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${filename.replace(/[^\w.-]/g, "_")}"`);
  res.setHeader("Cache-Control", "private, no-store");
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  doc.pipe(res);
  return doc;
}
async function header(doc, ctx, title) {
  const company = await Company.findById(ctx.companyId).lean();
  doc.fontSize(16).font("Helvetica-Bold").text(company?.legalName || company?.name || "", { align: "left" });
  doc.fontSize(9).font("Helvetica").fillColor("#555");
  const addr = [company?.address?.line1, company?.address?.city, company?.address?.state, company?.address?.pincode].filter(Boolean).join(", ");
  if (addr) doc.text(addr);
  if (company?.gstin) doc.text(`GSTIN: ${company.gstin}`);
  doc.moveDown(0.8).fillColor("#000").fontSize(13).font("Helvetica-Bold").text(title, { align: "center" }).moveDown(0.8);
  doc.font("Helvetica").fontSize(10);
}
function row(doc, label, value) {
  const y = doc.y;
  doc.font("Helvetica-Bold").text(label, 50, y, { width: 160 });
  doc.font("Helvetica").text(value, 210, y, { width: 335 });
  doc.moveDown(0.3);
}
async function receiptPdf(ctx, id, res) {
  const p = await getPayment(ctx, id);
  const doc = pdfResponse(res, `${p.number}.pdf`);
  await header(doc, ctx, p.kind === "refund" ? "REFUND VOUCHER" : "PAYMENT RECEIPT");
  if (p.status === "reversed")
    doc.fillColor("#b91c1c").font("Helvetica-Bold").text("REVERSED", { align: "center" }).fillColor("#000").moveDown(0.5);
  row(doc, p.kind === "refund" ? "Voucher No." : "Receipt No.", p.number);
  row(doc, "Date", formatDate(p.date.toISOString().slice(0, 10)));
  row(doc, "Customer", `${p.customerId?.name} (${p.customerId?.customerCode})`);
  row(doc, "Project", p.projectId?.name ?? "");
  row(doc, "Booking", p.bookingId?.bookingNumber ?? "");
  row(doc, "Amount", rs(p.amountPaise));
  row(doc, "Mode", `${p.mode.toUpperCase()}${p.reference ? ` \u2013 ${p.reference}` : ""}${p.bankName ? ` (${p.bankName})` : ""}`);
  if (p.allocations.length) {
    doc.moveDown(0.6).font("Helvetica-Bold").text("Applied to installments").font("Helvetica").moveDown(0.3);
    for (const a of p.allocations) {
      row(doc, a.installmentId?.name ?? "", `${rs(a.amountPaise)}${a.reversedAt ? " (reversed)" : ""}`);
    }
  }
  if (p.advancePaise) row(doc, "Held as advance", rs(p.advancePaise));
  doc.moveDown(2).fontSize(8).fillColor("#666").text("This is a computer-generated document. Subject to realisation of cheque/instrument.", { align: "center" });
  doc.end();
}
async function allotmentLetterPdf(ctx, id, res) {
  const b = await getBooking(ctx, id);
  const doc = pdfResponse(res, `${b.bookingNumber}-allotment.pdf`);
  await header(doc, ctx, b.status === "reserved" ? "PROVISIONAL RESERVATION LETTER" : "ALLOTMENT LETTER");
  row(doc, "Booking No.", b.bookingNumber);
  row(doc, "Booking Date", formatDate(b.bookingDate.toISOString().slice(0, 10)));
  row(doc, "Allottee", b.customerId?.name ?? "");
  if (b.customerId?.coApplicants?.length) row(doc, "Co-applicant(s)", b.customerId.coApplicants.map((c) => c.name).join(", "));
  row(doc, "Project", `${b.projectId?.name ?? ""}${b.projectId?.reraNumber ? ` (RERA: ${b.projectId.reraNumber})` : ""}`);
  doc.moveDown(0.5).font("Helvetica-Bold").text("Plot details").font("Helvetica").moveDown(0.3);
  for (const i of b.items) {
    row(
      doc,
      `Plot ${i.blockCode ? `${i.blockCode}-` : ""}${i.plotNumber}`,
      `${areaToSqft(i.areaX100)} sq ft @ ${rs(i.ratePaisePerSqft)}/sq ft${i.plcPaise ? ` + PLC ${rs(i.plcPaise)}` : ""} = ${rs(i.lineTotalPaise)}`
    );
  }
  doc.moveDown(0.3);
  row(doc, "Plot value", rs(b.grossAmountPaise));
  if (b.discountPaise) row(doc, "Discount", `- ${rs(b.discountPaise)}`);
  for (const c of b.charges) row(doc, c.name, rs(c.amountPaise));
  row(doc, "Total consideration", rs(b.netAmountPaise));
  doc.moveDown(0.5).font("Helvetica-Bold").text("Payment schedule").font("Helvetica").moveDown(0.3);
  for (const i of b.installments)
    row(doc, `${i.sequence}. ${i.name}`, `${formatDate(i.dueDate.toISOString().slice(0, 10))} \u2013 ${rs(i.amountPaise)}`);
  doc.moveDown(3).text("Authorised Signatory", 380);
  doc.end();
}
async function sendWorkbook(res, wb, filename) {
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "private, no-store");
  await wb.xlsx.write(res);
  res.end();
}
var MAX_EXPORT_ROWS = 1e4;
var rupees = (paise2) => paise2 / 100;
async function exportPlots(ctx, projectId, res) {
  const { items } = await listPlots(ctx, projectId, { page: 1, pageSize: MAX_EXPORT_ROWS });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Plots");
  ws.columns = [
    { header: "Block", key: "block", width: 10 },
    { header: "Plot No.", key: "plot", width: 12 },
    { header: "Category", key: "category", width: 14 },
    { header: "Facing", key: "facing", width: 12 },
    { header: "Area (sq ft)", key: "area", width: 14 },
    { header: "Rate (\u20B9/sq ft)", key: "rate", width: 14 },
    { header: "PLC %", key: "plc", width: 8 },
    { header: "List Price (\u20B9)", key: "price", width: 16 },
    { header: "Status", key: "status", width: 12 }
  ];
  for (const p of items) {
    ws.addRow({
      block: p.blockCode ?? "",
      plot: p.plotNumber,
      category: p.category,
      facing: p.facing ?? "",
      area: Number(areaToSqft(p.areaX100)),
      rate: rupees(p.ratePaisePerSqft),
      plc: p.plcBp / 100,
      price: rupees(p.listPricePaise),
      status: p.status
    });
  }
  ws.getRow(1).font = { bold: true };
  ws.getColumn("price").numFmt = "#,##,##0.00";
  await sendWorkbook(res, wb, "plots.xlsx");
}
async function exportPayments(ctx, q, projectId, res) {
  const { items } = await listPayments(ctx, { ...q, page: 1, pageSize: MAX_EXPORT_ROWS }, projectId);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Payments");
  ws.columns = [
    { header: "Number", key: "number", width: 22 },
    { header: "Date", key: "date", width: 12 },
    { header: "Type", key: "kind", width: 10 },
    { header: "Customer", key: "customer", width: 24 },
    { header: "Booking", key: "booking", width: 20 },
    { header: "Mode", key: "mode", width: 10 },
    { header: "Reference", key: "reference", width: 18 },
    { header: "Amount (\u20B9)", key: "amount", width: 16 },
    { header: "Status", key: "status", width: 10 }
  ];
  for (const p of items) {
    ws.addRow({
      number: p.number,
      date: p.date.toISOString().slice(0, 10),
      kind: p.kind,
      customer: p.customerId?.name ?? "",
      booking: p.bookingId?.bookingNumber ?? "",
      mode: p.mode,
      reference: p.reference ?? "",
      amount: rupees(p.amountPaise),
      status: p.status
    });
  }
  ws.getRow(1).font = { bold: true };
  await sendWorkbook(res, wb, "payments.xlsx");
}
async function exportBookings(ctx, q, projectId, res) {
  const { items } = await listBookings(ctx, { ...q, page: 1, pageSize: MAX_EXPORT_ROWS }, projectId);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Bookings");
  ws.columns = [
    { header: "Booking No.", key: "number", width: 20 },
    { header: "Date", key: "date", width: 12 },
    { header: "Project", key: "project", width: 18 },
    { header: "Customer", key: "customer", width: 24 },
    { header: "Plots", key: "plots", width: 18 },
    { header: "Net Amount (\u20B9)", key: "net", width: 16 },
    { header: "Received (\u20B9)", key: "received", width: 16 },
    { header: "Outstanding (\u20B9)", key: "due", width: 16 },
    { header: "Status", key: "status", width: 10 }
  ];
  for (const b of items) {
    ws.addRow({
      number: b.bookingNumber,
      date: b.bookingDate.toISOString().slice(0, 10),
      project: b.projectId?.code ?? "",
      customer: b.customerId?.name ?? "",
      plots: b.plots.join(", "),
      net: rupees(b.netAmountPaise),
      received: rupees(b.receivedPaise),
      due: ["reserved", "booked"].includes(b.status) ? rupees(b.netAmountPaise - b.allocatedPaise) : 0,
      status: b.status
    });
  }
  ws.getRow(1).font = { bold: true };
  await sendWorkbook(res, wb, "bookings.xlsx");
}

// src/modules/projects/projects.service.ts
function dateFields(input, keys) {
  const out = { ...input };
  for (const k of keys) if (typeof out[k] === "string") out[k] = parseISODate(out[k]);
  return out;
}
async function listProjects(ctx, q) {
  const filter = scopedFilter(ctx, void 0, "_id");
  if (q.status) filter.status = q.status;
  else if (!q.includeArchived) filter.status = { $ne: "archived" };
  if (q.q) filter.$or = [{ name: new RegExp(escapeRegex(q.q), "i") }, { code: new RegExp(escapeRegex(q.q), "i") }];
  const sort = parseSort(q.sort, ["name", "code", "createdAt", "status"], { createdAt: -1 });
  const [items, total] = await Promise.all([
    Project.find(filter).sort(sort).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(),
    Project.countDocuments(filter)
  ]);
  const stats = await Plot.aggregate([
    { $match: { companyId: ctx.companyId, projectId: { $in: items.map((p) => p._id) }, deletedAt: null } },
    { $group: { _id: { p: "$projectId", s: "$status" }, n: { $sum: 1 }, value: { $sum: "$listPricePaise" } } }
  ]);
  const withStats = items.map((p) => {
    const mine = stats.filter((s) => String(s._id.p) === String(p._id));
    const byStatus = Object.fromEntries(mine.map((s) => [s._id.s, s.n]));
    return { ...p, id: String(p._id), plotCounts: byStatus, totalPlots: mine.reduce((a, s) => a + s.n, 0) };
  });
  return { items: withStats, meta: pageMeta(q.page, q.pageSize, total) };
}
async function getProject(ctx, id) {
  assertProjectAccess(ctx, id);
  const project = await Project.findOne({ companyId: ctx.companyId, _id: toObjectId(id) }).lean();
  if (!project) throw notFound("Project");
  const [phases, blocks] = await Promise.all([
    ProjectPhase.find({ companyId: ctx.companyId, projectId: project._id }).sort({ sequence: 1 }).lean(),
    Block.find({ companyId: ctx.companyId, projectId: project._id }).sort({ code: 1 }).lean()
  ]);
  return { ...project, id: String(project._id), phases, blocks };
}
async function createProject(ctx, input) {
  if (ctx.projectScope !== null) throw businessRule("Users restricted to specific projects cannot create projects");
  const project = await Project.create({ companyId: ctx.companyId, ...dateFields(input, ["launchDate"]), createdBy: ctx.userId });
  await audit(ctx, { action: "projects.create", entityType: "project", entityId: project._id, summary: project.name });
  return project.toJSON();
}
async function updateProject(ctx, id, input) {
  assertProjectAccess(ctx, id);
  const project = await Project.findOneAndUpdate(
    { companyId: ctx.companyId, _id: toObjectId(id) },
    { $set: dateFields(input, ["launchDate"]) },
    { new: true, runValidators: true }
  ).lean();
  if (!project) throw notFound("Project");
  await audit(ctx, { action: "projects.update", entityType: "project", entityId: project._id, changes: input });
  return project;
}
async function archiveProject(ctx, id) {
  assertProjectAccess(ctx, id);
  const projectId = toObjectId(id);
  const active = await Plot.exists({ companyId: ctx.companyId, projectId, status: { $in: ["reserved", "booked"] } });
  if (active) throw businessRule("Projects with reserved or booked plots cannot be archived");
  const project = await Project.findOneAndUpdate(
    { companyId: ctx.companyId, _id: projectId },
    { $set: { status: "archived", archivedAt: /* @__PURE__ */ new Date() } },
    { new: true }
  ).lean();
  if (!project) throw notFound("Project");
  await audit(ctx, { action: "projects.archive", entityType: "project", entityId: projectId });
  return project;
}
async function updateMapConfig(ctx, id, map) {
  assertProjectAccess(ctx, id);
  const project = await Project.findOneAndUpdate(
    { companyId: ctx.companyId, _id: toObjectId(id) },
    { $set: { map } },
    { new: true }
  ).lean();
  if (!project) throw notFound("Project");
  return project.map;
}
async function requireProject2(ctx, projectId) {
  assertProjectAccess(ctx, projectId);
  const exists = await Project.exists({ companyId: ctx.companyId, _id: toObjectId(projectId) });
  if (!exists) throw notFound("Project");
  return toObjectId(projectId);
}
async function createPhase(ctx, projectId, input) {
  const pid2 = await requireProject2(ctx, projectId);
  const phase = await ProjectPhase.create({ companyId: ctx.companyId, projectId: pid2, ...dateFields(input, ["startDate", "targetDate"]) });
  await audit(ctx, { action: "projects.phase_create", entityType: "phase", entityId: phase._id, summary: phase.name });
  return phase.toJSON();
}
async function updatePhase(ctx, projectId, phaseId, input) {
  const pid2 = await requireProject2(ctx, projectId);
  const phase = await ProjectPhase.findOneAndUpdate(
    { companyId: ctx.companyId, projectId: pid2, _id: toObjectId(phaseId) },
    { $set: dateFields(input, ["startDate", "targetDate"]) },
    { new: true, runValidators: true }
  ).lean();
  if (!phase) throw notFound("Phase");
  return phase;
}
async function deletePhase(ctx, projectId, phaseId) {
  const pid2 = await requireProject2(ctx, projectId);
  const id = toObjectId(phaseId);
  if (await Plot.exists({ companyId: ctx.companyId, projectId: pid2, phaseId: id, deletedAt: null })) throw businessRule("Phase has plots");
  if (await Block.exists({ companyId: ctx.companyId, projectId: pid2, phaseId: id })) throw businessRule("Phase has blocks");
  const res = await ProjectPhase.deleteOne({ companyId: ctx.companyId, projectId: pid2, _id: id });
  if (!res.deletedCount) throw notFound("Phase");
}
async function createBlock(ctx, projectId, input) {
  const pid2 = await requireProject2(ctx, projectId);
  if (input.phaseId && !await ProjectPhase.exists({ companyId: ctx.companyId, projectId: pid2, _id: toObjectId(input.phaseId) })) {
    throw badRequest("Phase does not belong to this project");
  }
  const block = await Block.create({ companyId: ctx.companyId, projectId: pid2, ...input });
  await audit(ctx, { action: "projects.block_create", entityType: "block", entityId: block._id, summary: block.name });
  return block.toJSON();
}
async function updateBlock(ctx, projectId, blockId, input) {
  const pid2 = await requireProject2(ctx, projectId);
  if (input.phaseId && !await ProjectPhase.exists({ companyId: ctx.companyId, projectId: pid2, _id: toObjectId(input.phaseId) })) {
    throw badRequest("Phase does not belong to this project");
  }
  const block = await Block.findOneAndUpdate(
    { companyId: ctx.companyId, projectId: pid2, _id: toObjectId(blockId) },
    { $set: input },
    { new: true, runValidators: true }
  ).lean();
  if (!block) throw notFound("Block");
  return block;
}
async function deleteBlock(ctx, projectId, blockId) {
  const pid2 = await requireProject2(ctx, projectId);
  const id = toObjectId(blockId);
  if (await Plot.exists({ companyId: ctx.companyId, projectId: pid2, blockId: id, deletedAt: null })) throw businessRule("Block has plots");
  const res = await Block.deleteOne({ companyId: ctx.companyId, projectId: pid2, _id: id });
  if (!res.deletedCount) throw notFound("Block");
}

// src/modules/projects/projects.routes.ts
var projectsRouter = Router4();
var pid = z13.object({ id: objectId });
var pidPhase = z13.object({ id: objectId, phaseId: objectId });
var pidBlock = z13.object({ id: objectId, blockId: objectId });
var pidPlot = z13.object({ id: objectId, plotId: objectId });
var projectListQuery = listQuerySchema.extend({
  status: z13.enum(PROJECT_STATUSES).optional(),
  includeArchived: z13.enum(["true", "false"]).transform((v) => v === "true").optional()
});
projectsRouter.get("/", authorize("projects.read"), validate({ query: projectListQuery }), async (req, res) => {
  const { items, meta: meta2 } = await listProjects(getCtx(req), query(req));
  ok(res, items, meta2);
});
projectsRouter.post(
  "/",
  authorize("projects.create"),
  validate({ body: projectSchema }),
  async (req, res) => created(res, await createProject(getCtx(req), body(req)))
);
projectsRouter.get(
  "/:id",
  authorize("projects.read"),
  validate({ params: pid }),
  async (req, res) => ok(res, await getProject(getCtx(req), params(req).id))
);
projectsRouter.patch(
  "/:id",
  authorize("projects.update"),
  validate({ params: pid, body: projectUpdateSchema }),
  async (req, res) => ok(res, await updateProject(getCtx(req), params(req).id, body(req)))
);
projectsRouter.post(
  "/:id/archive",
  authorize("projects.archive"),
  validate({ params: pid }),
  async (req, res) => ok(res, await archiveProject(getCtx(req), params(req).id))
);
projectsRouter.post(
  "/:id/phases",
  authorize("projects.update"),
  validate({ params: pid, body: phaseSchema }),
  async (req, res) => created(res, await createPhase(getCtx(req), params(req).id, body(req)))
);
projectsRouter.patch(
  "/:id/phases/:phaseId",
  authorize("projects.update"),
  validate({ params: pidPhase, body: patchSchema(phaseSchema) }),
  async (req, res) => {
    const p = params(req);
    ok(res, await updatePhase(getCtx(req), p.id, p.phaseId, body(req)));
  }
);
projectsRouter.delete("/:id/phases/:phaseId", authorize("projects.update"), validate({ params: pidPhase }), async (req, res) => {
  const p = params(req);
  await deletePhase(getCtx(req), p.id, p.phaseId);
  ok(res, { deleted: true });
});
projectsRouter.post(
  "/:id/blocks",
  authorize("projects.update"),
  validate({ params: pid, body: blockSchema }),
  async (req, res) => created(res, await createBlock(getCtx(req), params(req).id, body(req)))
);
projectsRouter.patch(
  "/:id/blocks/:blockId",
  authorize("projects.update"),
  validate({ params: pidBlock, body: patchSchema(blockSchema) }),
  async (req, res) => {
    const p = params(req);
    ok(res, await updateBlock(getCtx(req), p.id, p.blockId, body(req)));
  }
);
projectsRouter.delete("/:id/blocks/:blockId", authorize("projects.update"), validate({ params: pidBlock }), async (req, res) => {
  const p = params(req);
  await deleteBlock(getCtx(req), p.id, p.blockId);
  ok(res, { deleted: true });
});
projectsRouter.get("/:id/plots", authorize("inventory.read"), validate({ params: pid, query: plotListQuerySchema }), async (req, res) => {
  const { items, meta: meta2 } = await listPlots(getCtx(req), params(req).id, query(req));
  ok(res, items, meta2);
});
projectsRouter.get("/:id/plots.xlsx", authorize("inventory.read", "reports.export"), validate({ params: pid }), async (req, res) => {
  await exportPlots(getCtx(req), params(req).id, res);
});
projectsRouter.post(
  "/:id/plots",
  authorize("inventory.create"),
  validate({ params: pid, body: plotSchema }),
  async (req, res) => created(res, await createPlot(getCtx(req), params(req).id, body(req)))
);
projectsRouter.post(
  "/:id/plots/bulk",
  authorize("inventory.create"),
  validate({ params: pid, body: bulkPlotSchema }),
  async (req, res) => created(res, await bulkCreatePlots(getCtx(req), params(req).id, body(req)))
);
projectsRouter.get("/:id/plots/:plotId", authorize("inventory.read"), validate({ params: pidPlot }), async (req, res) => {
  const p = params(req);
  ok(res, await getPlot(getCtx(req), p.id, p.plotId));
});
projectsRouter.patch(
  "/:id/plots/:plotId",
  authorize("inventory.update"),
  validate({ params: pidPlot, body: plotUpdateSchema }),
  async (req, res) => {
    const p = params(req);
    ok(res, await updatePlot(getCtx(req), p.id, p.plotId, body(req)));
  }
);
projectsRouter.post(
  "/:id/plots/:plotId/status",
  authorize("inventory.status"),
  validate({ params: pidPlot, body: plotStatusChangeSchema }),
  async (req, res) => {
    const p = params(req);
    const b = body(req);
    ok(res, await changePlotStatus(getCtx(req), p.id, p.plotId, b.status, b.reason));
  }
);
projectsRouter.delete("/:id/plots/:plotId", authorize("inventory.delete"), validate({ params: pidPlot }), async (req, res) => {
  const p = params(req);
  await deletePlot(getCtx(req), p.id, p.plotId);
  ok(res, { deleted: true });
});
projectsRouter.get(
  "/:id/map",
  authorize("map.read"),
  validate({ params: pid }),
  async (req, res) => ok(res, await getMapData(getCtx(req), params(req).id))
);
projectsRouter.put(
  "/:id/map",
  authorize("map.edit"),
  validate({ params: pid, body: mapConfigSchema }),
  async (req, res) => ok(res, await updateMapConfig(getCtx(req), params(req).id, body(req)))
);
projectsRouter.put(
  "/:id/map/shapes",
  authorize("map.edit"),
  validate({ params: pid, body: mapShapesBulkSchema }),
  async (req, res) => ok(
    res,
    await saveMapShapes(getCtx(req), params(req).id, body(req).shapes)
  )
);

// src/modules/reports/reports.routes.ts
import { Router as Router5 } from "express";
import { z as z14 } from "zod";

// src/modules/reports/dashboard.service.ts
function monthStart(iso2) {
  return `${iso2.slice(0, 7)}-01`;
}
async function getDashboard(ctx, projectId) {
  const base2 = scopedFilter(ctx, projectId);
  const today = todayInIndia();
  const todayDate = parseISODate(today);
  const thisMonth = parseISODate(monthStart(today));
  const fyStart = parseISODate(`${financialYear(today).slice(0, 4)}-04-01`);
  const trendStartIso = addMonths(monthStart(today), -11);
  const trendStart = parseISODate(trendStartIso);
  const months = Array.from({ length: 12 }, (_, i) => addMonths(trendStartIso, i).slice(0, 7));
  const result = { asOf: today, months };
  if (hasPermission(ctx, "inventory.read")) {
    const inv = await Plot.aggregate([
      { $match: { ...base2, deletedAt: null } },
      { $group: { _id: "$status", count: { $sum: 1 }, value: { $sum: "$listPricePaise" }, area: { $sum: "$areaX100" } } }
    ]);
    const byStatus = Object.fromEntries(inv.map((r) => [r._id, { count: r.count, valuePaise: r.value, areaX100: r.area }]));
    result.inventory = {
      byStatus,
      totalPlots: inv.reduce((s, r) => s + r.count, 0),
      availableValuePaise: byStatus.available?.valuePaise ?? 0
    };
  }
  if (hasPermission(ctx, "bookings.read")) {
    const active = { ...base2, status: { $in: ["reserved", "booked"] } };
    const [month, fy, trend, outstanding2, recent] = await Promise.all([
      Booking.aggregate([
        { $match: { ...active, bookingDate: { $gte: thisMonth } } },
        { $group: { _id: null, count: { $sum: 1 }, value: { $sum: "$netAmountPaise" } } }
      ]),
      Booking.aggregate([
        { $match: { ...active, bookingDate: { $gte: fyStart } } },
        { $group: { _id: null, count: { $sum: 1 }, value: { $sum: "$netAmountPaise" } } }
      ]),
      Booking.aggregate([
        { $match: { ...active, bookingDate: { $gte: trendStart } } },
        {
          $group: {
            _id: { $dateToString: { date: "$bookingDate", format: "%Y-%m" } },
            count: { $sum: 1 },
            value: { $sum: "$netAmountPaise" }
          }
        }
      ]),
      Booking.aggregate([
        { $match: active },
        { $group: { _id: null, value: { $sum: { $subtract: ["$netAmountPaise", "$allocatedPaise"] } } } }
      ]),
      Booking.find(base2).sort({ createdAt: -1 }).limit(6).select("bookingNumber status netAmountPaise bookingDate customerId").populate({ path: "customerId", select: "name", match: { companyId: ctx.companyId } }).lean()
    ]);
    const trendMap = new Map(trend.map((t) => [t._id, t]));
    result.sales = {
      monthCount: month[0]?.count ?? 0,
      monthValuePaise: month[0]?.value ?? 0,
      fyCount: fy[0]?.count ?? 0,
      fyValuePaise: fy[0]?.value ?? 0,
      outstandingPaise: outstanding2[0]?.value ?? 0,
      trend: months.map((m) => ({ month: m, count: trendMap.get(m)?.count ?? 0, valuePaise: trendMap.get(m)?.value ?? 0 })),
      recent
    };
  }
  if (hasPermission(ctx, "payments.read")) {
    const receipts = { ...base2, kind: "receipt", status: "received" };
    const openInst = { ...base2, status: { $in: ["pending", "partial"] } };
    const [month, fy, trend, overdue, upcoming] = await Promise.all([
      Payment.aggregate([
        { $match: { ...receipts, date: { $gte: thisMonth } } },
        { $group: { _id: null, value: { $sum: "$amountPaise" } } }
      ]),
      Payment.aggregate([
        { $match: { ...receipts, date: { $gte: fyStart } } },
        { $group: { _id: null, value: { $sum: "$amountPaise" } } }
      ]),
      Payment.aggregate([
        { $match: { ...receipts, date: { $gte: trendStart } } },
        { $group: { _id: { $dateToString: { date: "$date", format: "%Y-%m" } }, value: { $sum: "$amountPaise" } } }
      ]),
      Installment.aggregate([
        { $match: { ...openInst, dueDate: { $lt: todayDate } } },
        { $group: { _id: null, value: { $sum: { $subtract: ["$amountPaise", "$paidPaise"] } }, count: { $sum: 1 } } }
      ]),
      Installment.find({ ...openInst, dueDate: { $gte: todayDate, $lte: parseISODate(addDays(today, 30)) } }).sort({ dueDate: 1 }).limit(8).select("name dueDate amountPaise paidPaise bookingId customerId").populate({ path: "customerId", select: "name phone", match: { companyId: ctx.companyId } }).populate({ path: "bookingId", select: "bookingNumber", match: { companyId: ctx.companyId } }).lean()
    ]);
    const trendMap = new Map(trend.map((t) => [t._id, t.value]));
    result.collections = {
      monthPaise: month[0]?.value ?? 0,
      fyPaise: fy[0]?.value ?? 0,
      overduePaise: overdue[0]?.value ?? 0,
      overdueCount: overdue[0]?.count ?? 0,
      trend: months.map((m) => ({ month: m, valuePaise: trendMap.get(m) ?? 0 })),
      upcoming
    };
  }
  if (hasPermission(ctx, "accounting.read")) {
    const expenseIds = (await Account.find({ companyId: ctx.companyId, type: "expense" }).select("_id").lean()).map(
      (a) => a._id
    );
    const jeMatch = { companyId: ctx.companyId, date: { $gte: trendStart } };
    if (base2.projectId) jeMatch.projectId = base2.projectId;
    const rows = await JournalEntry.aggregate([
      { $match: { ...jeMatch, "lines.accountId": { $in: expenseIds } } },
      { $unwind: "$lines" },
      { $match: { "lines.accountId": { $in: expenseIds } } },
      {
        $group: {
          _id: { $dateToString: { date: "$date", format: "%Y-%m" } },
          value: { $sum: { $subtract: ["$lines.debitPaise", "$lines.creditPaise"] } }
        }
      }
    ]);
    const map = new Map(rows.map((r) => [r._id, r.value]));
    result.expenses = {
      monthPaise: map.get(today.slice(0, 7)) ?? 0,
      trend: months.map((m) => ({ month: m, valuePaise: map.get(m) ?? 0 }))
    };
  }
  const ops = {};
  if (hasPermission(ctx, "crm.read")) {
    const leadMatch = { companyId: ctx.companyId, deletedAt: null };
    if (base2.projectId) leadMatch.projectId = base2.projectId;
    if (ctx.projectScope !== null && !base2.projectId)
      leadMatch.$or = [{ projectId: { $in: ctx.projectScope } }, { assignedTo: ctx.userId }];
    const [open, due, won] = await Promise.all([
      Lead.countDocuments({ ...leadMatch, status: { $in: OPEN_LEAD_STATUSES } }),
      Lead.countDocuments({ ...leadMatch, status: { $in: OPEN_LEAD_STATUSES }, nextFollowUpAt: { $lte: /* @__PURE__ */ new Date() } }),
      Lead.countDocuments({ ...leadMatch, status: "won", convertedAt: { $gte: thisMonth } })
    ]);
    ops.leads = { open, followUpsDue: due, wonThisMonth: won };
  }
  if (hasPermission(ctx, "land.read")) {
    const landMatch = { companyId: ctx.companyId, deletedAt: null, status: { $ne: "dropped" } };
    if (base2.projectId) landMatch.projectId = base2.projectId;
    const l = await LandParcel.aggregate([
      { $match: landMatch },
      { $group: { _id: null, agreed: { $sum: { $ifNull: ["$agreedCostPaise", 0] } }, paid: { $sum: "$paidPaise" }, n: { $sum: 1 } } }
    ]);
    ops.land = { parcels: l[0]?.n ?? 0, agreedCostPaise: l[0]?.agreed ?? 0, paidPaise: l[0]?.paid ?? 0 };
  }
  if (hasPermission(ctx, "construction.read")) {
    const w = await WorkOrder.aggregate([
      { $match: { ...base2, status: { $in: ["issued", "in_progress", "completed"] } } },
      {
        $group: {
          _id: null,
          committed: { $sum: "$amountPaise" },
          billed: { $sum: "$billedPaise" },
          open: { $sum: { $cond: [{ $in: ["$status", ["issued", "in_progress"]] }, 1, 0] } }
        }
      }
    ]);
    ops.construction = { openWorkOrders: w[0]?.open ?? 0, committedPaise: w[0]?.committed ?? 0, billedPaise: w[0]?.billed ?? 0 };
  }
  if (Object.keys(ops).length) result.operations = ops;
  return result;
}

// src/modules/reports/reports.routes.ts
var reportsRouter = Router5();
reportsRouter.get(
  "/dashboard",
  authorize("dashboard.read"),
  validate({ query: z14.object({ projectId: objectId.optional() }) }),
  async (req, res) => ok(res, await getDashboard(getCtx(req), query(req).projectId))
);
reportsRouter.get("/search", validate({ query: z14.object({ q: z14.string().trim().min(2).max(60) }) }), async (req, res) => {
  const ctx = getCtx(req);
  const rx = new RegExp(escapeRegex(query(req).q), "i");
  const scoped = scopedFilter(ctx);
  const [projects, plots, customers, bookings, leads, vendors, land] = await Promise.all([
    hasPermission(ctx, "projects.read") ? Project.find({ ...scopedFilter(ctx, void 0, "_id"), $or: [{ name: rx }, { code: rx }] }).select("name code").limit(5).lean() : [],
    hasPermission(ctx, "inventory.read") ? Plot.find({ ...scoped, plotNumber: rx }).select("plotNumber projectId status").limit(5).lean() : [],
    hasPermission(ctx, "customers.read") && ctx.projectScope === null ? Customer.find({ companyId: ctx.companyId, deletedAt: null, $or: [{ name: rx }, { phone: rx }, { customerCode: rx }] }).select("name phone customerCode").limit(5).lean() : [],
    hasPermission(ctx, "bookings.read") ? Booking.find({ ...scoped, bookingNumber: rx }).select("bookingNumber status").limit(5).lean() : [],
    hasPermission(ctx, "crm.read") ? Lead.find({
      companyId: ctx.companyId,
      deletedAt: null,
      $and: [
        { $or: [{ name: rx }, { phone: rx }] },
        ctx.projectScope === null ? {} : { $or: [{ projectId: { $in: ctx.projectScope } }, { assignedTo: ctx.userId }, { createdBy: ctx.userId }] }
      ]
    }).select("name phone status").limit(5).lean() : [],
    hasPermission(ctx, "vendors.read") ? Vendor.find({ companyId: ctx.companyId, name: rx }).select("name category").limit(5).lean() : [],
    hasPermission(ctx, "land.read") ? LandParcel.find({
      companyId: ctx.companyId,
      deletedAt: null,
      ...ctx.projectScope === null ? {} : { projectId: { $in: ctx.projectScope } },
      $or: [{ khasraNumber: rx }, { village: rx }, { "owners.name": rx }]
    }).select("khasraNumber village status").limit(5).lean() : []
  ]);
  ok(res, { projects, plots, customers, bookings, leads, vendors, land });
});

// src/modules/sales.routes.ts
import { Router as Router6 } from "express";
import { z as z15 } from "zod";

// src/middleware/idempotency.ts
var TTL_HOURS = 24;
function idempotent(req, res, next) {
  const key = req.get("idempotency-key");
  if (!key || !/^[\w-]{8,100}$/.test(key)) {
    throw badRequest("An Idempotency-Key header (8-100 characters) is required for this request");
  }
  const ctx = getCtx(req);
  const route = `${req.method} ${req.baseUrl}${req.route?.path ?? req.path}`;
  const requestHash = sha256(stableStringify({ route, params: req.params, body: req.body }));
  const filter = { companyId: ctx.companyId, userId: ctx.userId, key };
  const run = async () => {
    try {
      await IdempotencyKey.create({
        ...filter,
        route,
        requestHash,
        state: "in_progress",
        expiresAt: new Date(Date.now() + TTL_HOURS * 36e5)
      });
    } catch (err) {
      if (err.code !== 11e3) throw err;
      const existing = await IdempotencyKey.findOne(filter).lean();
      if (!existing) throw new AppError(409, "IDEMPOTENCY_CONFLICT", "Request is being processed, retry shortly");
      if (existing.requestHash !== requestHash) {
        throw new AppError(422, "IDEMPOTENCY_CONFLICT", "This Idempotency-Key was already used with a different request");
      }
      if (existing.state === "in_progress") {
        throw new AppError(409, "IDEMPOTENCY_CONFLICT", "An identical request is still being processed");
      }
      res.setHeader("idempotent-replayed", "true");
      res.status(existing.responseStatus ?? 200).json(existing.responseBody);
      return;
    }
    const originalJson = res.json.bind(res);
    res.json = (payload) => {
      const status = res.statusCode;
      const done = status < 400 ? IdempotencyKey.updateOne(filter, { $set: { state: "completed", responseStatus: status, responseBody: payload } }) : IdempotencyKey.deleteOne(filter);
      done.then(
        () => originalJson(payload),
        () => originalJson(payload)
      );
      return res;
    };
    next();
  };
  return run();
}

// src/modules/bookings/payment-plans.service.ts
async function listPlans(ctx, projectId) {
  const filter = { companyId: ctx.companyId };
  if (projectId) {
    assertProjectAccess(ctx, projectId);
    filter.$or = [{ projectId: null }, { projectId: toObjectId(projectId) }];
  }
  return PaymentPlan.find(filter).sort({ isActive: -1, name: 1 }).lean();
}
async function validatePlan(ctx, input) {
  if (input.projectId) {
    assertProjectAccess(ctx, input.projectId);
    if (!await Project.exists({ companyId: ctx.companyId, _id: toObjectId(input.projectId) })) throw badRequest("Project not found");
  }
  if (input.rules) generateSchedule(input.rules, 1e9, todayInIndia());
}
async function createPlan(ctx, input) {
  await validatePlan(ctx, input);
  const plan = await PaymentPlan.create({ companyId: ctx.companyId, ...input, projectId: input.projectId ?? null });
  await audit(ctx, { action: "paymentPlans.create", entityType: "payment_plan", entityId: plan._id, summary: plan.name });
  return plan.toJSON();
}
async function updatePlan(ctx, id, input) {
  await validatePlan(ctx, input);
  const plan = await PaymentPlan.findOneAndUpdate(
    { companyId: ctx.companyId, _id: toObjectId(id) },
    { $set: { ...input, projectId: input.projectId ?? null } },
    { new: true, runValidators: true }
  ).lean();
  if (!plan) throw notFound("Payment plan");
  await audit(ctx, { action: "paymentPlans.update", entityType: "payment_plan", entityId: plan._id, changes: input });
  return plan;
}

// src/modules/sales.routes.ts
var projectQuery = z15.object({ projectId: objectId.optional() });
var customersRouter = Router6();
customersRouter.get("/", authorize("customers.read"), validate({ query: listQuerySchema }), async (req, res) => {
  const { items, meta: meta2 } = await listCustomers(getCtx(req), query(req));
  ok(res, items, meta2);
});
customersRouter.post(
  "/",
  authorize("customers.create"),
  validate({ body: customerSchema }),
  async (req, res) => created(res, await createCustomer(getCtx(req), body(req)))
);
customersRouter.get(
  "/:id",
  authorize("customers.read"),
  validate({ params: idParam }),
  async (req, res) => ok(res, await getCustomer(getCtx(req), params(req).id))
);
customersRouter.patch(
  "/:id",
  authorize("customers.update"),
  validate({ params: idParam, body: customerUpdateSchema }),
  async (req, res) => ok(res, await updateCustomer(getCtx(req), params(req).id, body(req)))
);
customersRouter.delete("/:id", authorize("customers.delete"), validate({ params: idParam }), async (req, res) => {
  await deleteCustomer(getCtx(req), params(req).id);
  ok(res, { deleted: true });
});
customersRouter.get(
  "/:id/ledger",
  authorize("customers.read", "payments.read"),
  validate({ params: idParam }),
  async (req, res) => ok(res, await customerLedger(getCtx(req), params(req).id))
);
var plansRouter = Router6();
plansRouter.get(
  "/",
  authorize("paymentPlans.read"),
  validate({ query: projectQuery }),
  async (req, res) => ok(res, await listPlans(getCtx(req), query(req).projectId))
);
plansRouter.post(
  "/",
  authorize("paymentPlans.create"),
  validate({ body: paymentPlanSchema }),
  async (req, res) => created(res, await createPlan(getCtx(req), body(req)))
);
plansRouter.put(
  "/:id",
  authorize("paymentPlans.update"),
  validate({ params: idParam, body: paymentPlanSchema }),
  async (req, res) => ok(res, await updatePlan(getCtx(req), params(req).id, body(req)))
);
var bookingsRouter = Router6();
var bookingQuery = bookingListQuerySchema.extend({ projectId: objectId.optional() });
bookingsRouter.get("/", authorize("bookings.read"), validate({ query: bookingQuery }), async (req, res) => {
  const q = query(req);
  const { items, meta: meta2 } = await listBookings(getCtx(req), q, q.projectId);
  ok(res, items, meta2);
});
bookingsRouter.get("/export.xlsx", authorize("bookings.read", "reports.export"), validate({ query: bookingQuery }), async (req, res) => {
  const q = query(req);
  await exportBookings(getCtx(req), q, q.projectId, res);
});
bookingsRouter.post(
  "/quote",
  authorize("bookings.read"),
  validate({ body: quoteSchema }),
  async (req, res) => ok(res, await quote(getCtx(req), body(req)))
);
bookingsRouter.post(
  "/",
  authorize("bookings.create"),
  validate({ body: createBookingSchema }),
  idempotent,
  async (req, res) => created(res, await createBooking(getCtx(req), body(req)))
);
bookingsRouter.get(
  "/:id",
  authorize("bookings.read"),
  validate({ params: idParam }),
  async (req, res) => ok(res, await getBooking(getCtx(req), params(req).id))
);
bookingsRouter.get("/:id/allotment.pdf", authorize("bookings.read"), validate({ params: idParam }), async (req, res) => {
  await allotmentLetterPdf(getCtx(req), params(req).id, res);
});
bookingsRouter.post(
  "/:id/confirm",
  authorize("bookings.confirm"),
  validate({ params: idParam }),
  async (req, res) => ok(res, await confirmBooking(getCtx(req), params(req).id))
);
bookingsRouter.post(
  "/:id/cancel",
  authorize("bookings.cancel"),
  validate({ params: idParam, body: cancelBookingSchema }),
  async (req, res) => ok(res, await cancelBooking(getCtx(req), params(req).id, body(req)))
);
bookingsRouter.post(
  "/:id/refunds",
  authorize("payments.refund"),
  validate({ params: idParam, body: refundSchema }),
  idempotent,
  async (req, res) => created(res, await refundBooking(getCtx(req), params(req).id, body(req)))
);
var paymentsRouter = Router6();
var paymentQuery = paymentListQuerySchema.extend({ projectId: objectId.optional() });
paymentsRouter.get("/", authorize("payments.read"), validate({ query: paymentQuery }), async (req, res) => {
  const q = query(req);
  const { items, meta: meta2 } = await listPayments(getCtx(req), q, q.projectId);
  ok(res, items, meta2);
});
paymentsRouter.get("/export.xlsx", authorize("payments.read", "reports.export"), validate({ query: paymentQuery }), async (req, res) => {
  const q = query(req);
  await exportPayments(getCtx(req), q, q.projectId, res);
});
paymentsRouter.post(
  "/",
  authorize("payments.create"),
  validate({ body: recordPaymentSchema }),
  idempotent,
  async (req, res) => created(res, await recordPayment(getCtx(req), body(req)))
);
paymentsRouter.get(
  "/:id",
  authorize("payments.read"),
  validate({ params: idParam }),
  async (req, res) => ok(res, await getPayment(getCtx(req), params(req).id))
);
paymentsRouter.get("/:id/receipt.pdf", authorize("payments.read"), validate({ params: idParam }), async (req, res) => {
  await receiptPdf(getCtx(req), params(req).id, res);
});
paymentsRouter.post(
  "/:id/reverse",
  authorize("payments.reverse"),
  validate({ params: idParam, body: reversePaymentSchema }),
  async (req, res) => ok(res, await reversePayment(getCtx(req), params(req).id, body(req).reason))
);

// src/modules/brokers/brokers.routes.ts
import { Router as Router7 } from "express";
import { z as z16 } from "zod";
var brokersRouter = Router7();
brokersRouter.get(
  "/",
  authorize("brokers.read"),
  validate({ query: z16.object({ q: z16.string().trim().max(60).optional(), includeInactive: z16.enum(["true", "false"]).optional() }) }),
  async (req, res) => {
    const q = query(req);
    ok(res, await listBrokers(getCtx(req), q.q, q.includeInactive === "true"));
  }
);
brokersRouter.post(
  "/",
  authorize("brokers.create"),
  validate({ body: brokerSchema }),
  async (req, res) => created(res, await createBroker(getCtx(req), body(req)))
);
brokersRouter.get(
  "/:id",
  authorize("brokers.read"),
  validate({ params: idParam }),
  async (req, res) => ok(res, await getBroker(getCtx(req), params(req).id))
);
brokersRouter.patch(
  "/:id",
  authorize("brokers.update"),
  validate({ params: idParam, body: patchSchema(brokerSchema) }),
  async (req, res) => ok(res, await updateBroker(getCtx(req), params(req).id, body(req)))
);
brokersRouter.post(
  "/:id/payouts",
  authorize("brokers.payout"),
  validate({ params: idParam, body: brokerPayoutSchema }),
  idempotent,
  async (req, res) => created(res, await payoutCommissions(getCtx(req), params(req).id, body(req)))
);

// src/modules/construction/construction.routes.ts
import { Router as Router8 } from "express";
import { z as z17 } from "zod";

// src/modules/construction/construction.service.ts
import { Types as Types11 } from "mongoose";
async function listVendors(ctx, q) {
  const filter = { companyId: ctx.companyId };
  if (!q.includeInactive) filter.isActive = true;
  if (q.category) filter.category = q.category;
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), "i");
    filter.$or = [{ name: rx }, { phone: rx }, { gstin: rx }];
  }
  const sort = parseSort(q.sort, ["name", "createdAt", "category"], { name: 1 });
  const [items, total] = await Promise.all([
    Vendor.find(filter).collation({ locale: "en" }).sort(sort).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(),
    Vendor.countDocuments(filter)
  ]);
  const payableId = await systemAccountId(ctx.companyId, "vendor_payable");
  const balances = await JournalEntry.aggregate([
    { $match: { companyId: ctx.companyId, "lines.vendorId": { $in: items.map((v) => v._id) } } },
    { $unwind: "$lines" },
    { $match: { "lines.accountId": payableId, "lines.vendorId": { $in: items.map((v) => v._id) } } },
    { $group: { _id: "$lines.vendorId", debit: { $sum: "$lines.debitPaise" }, credit: { $sum: "$lines.creditPaise" } } }
  ]);
  return {
    items: items.map((v) => {
      const b = balances.find((x) => String(x._id) === String(v._id));
      return { ...v, payablePaise: (b?.credit ?? 0) - (b?.debit ?? 0) };
    }),
    meta: pageMeta(q.page, q.pageSize, total)
  };
}
async function getVendor(ctx, id) {
  const vendor = await Vendor.findOne({ companyId: ctx.companyId, _id: toObjectId(id) }).lean();
  if (!vendor) throw notFound("Vendor");
  const projectFilter = ctx.projectScope !== null ? { projectId: { $in: ctx.projectScope } } : {};
  const [workOrders, payableBalancePaise, ledger] = await Promise.all([
    WorkOrder.find({ companyId: ctx.companyId, vendorId: vendor._id, ...projectFilter }).sort({ createdAt: -1 }).populate({ path: "projectId", select: "name code", match: { companyId: ctx.companyId } }).lean(),
    partyBalance(ctx.companyId, { vendorId: vendor._id }, "vendor_payable"),
    vendorLedger(ctx, vendor._id)
  ]);
  return { ...vendor, workOrders, payableBalancePaise, ledger };
}
async function vendorLedger(ctx, vendorId) {
  const payableId = await systemAccountId(ctx.companyId, "vendor_payable");
  const rows = await JournalEntry.aggregate([
    { $match: { companyId: ctx.companyId, "lines.vendorId": vendorId } },
    { $sort: { date: 1, createdAt: 1, _id: 1 } },
    { $unwind: "$lines" },
    { $match: { "lines.vendorId": vendorId, "lines.accountId": payableId } },
    {
      $project: {
        entryNumber: 1,
        date: 1,
        narration: { $ifNull: ["$lines.narration", "$narration"] },
        debitPaise: "$lines.debitPaise",
        creditPaise: "$lines.creditPaise"
      }
    }
  ]);
  let bal = 0;
  return rows.map((r) => ({ ...r, balancePaise: bal += r.creditPaise - r.debitPaise }));
}
async function createVendor(ctx, input) {
  const vendor = await Vendor.create({ companyId: ctx.companyId, ...input, createdBy: ctx.userId });
  await audit(ctx, { action: "vendors.create", entityType: "vendor", entityId: vendor._id, summary: vendor.name });
  return vendor.toJSON();
}
async function updateVendor(ctx, id, input) {
  const vendor = await Vendor.findOneAndUpdate(
    { companyId: ctx.companyId, _id: toObjectId(id) },
    { $set: input },
    { new: true, runValidators: true }
  ).lean();
  if (!vendor) throw notFound("Vendor");
  await audit(ctx, { action: "vendors.update", entityType: "vendor", entityId: vendor._id, changes: input });
  return vendor;
}
async function requireProject3(ctx, projectId) {
  assertProjectAccess(ctx, projectId);
  const p = await Project.findOne({ companyId: ctx.companyId, _id: toObjectId(projectId) }).select("status").lean();
  if (!p) throw badRequest("Project not found");
  if (p.status === "archived") throw businessRule("Project is archived");
  return p._id;
}
async function listWorkOrders(ctx, q) {
  const filter = scopedFilter(ctx, q.projectId);
  if (q.status) filter.status = q.status;
  if (q.vendorId) filter.vendorId = toObjectId(q.vendorId);
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), "i");
    filter.$or = [{ number: rx }, { title: rx }];
  }
  const sort = parseSort(q.sort, ["number", "createdAt", "amountPaise", "status"], { createdAt: -1 });
  const [items, total] = await Promise.all([
    WorkOrder.find(filter).sort(sort).skip((q.page - 1) * q.pageSize).limit(q.pageSize).populate({ path: "vendorId", select: "name category", match: { companyId: ctx.companyId } }).populate({ path: "projectId", select: "name code", match: { companyId: ctx.companyId } }).lean(),
    WorkOrder.countDocuments(filter)
  ]);
  return { items, meta: pageMeta(q.page, q.pageSize, total) };
}
async function getWorkOrder(ctx, id) {
  const wo = await WorkOrder.findOne({ companyId: ctx.companyId, _id: toObjectId(id) }).populate({ path: "vendorId", select: "name category phone gstin", match: { companyId: ctx.companyId } }).populate({ path: "projectId", select: "name code", match: { companyId: ctx.companyId } }).lean();
  if (!wo) throw notFound("Work order");
  assertProjectAccess(ctx, wo.projectId?._id ?? wo.projectId);
  const bills = await Expense.find({ companyId: ctx.companyId, workOrderId: wo._id }).sort({ date: -1 }).lean();
  return { ...wo, bills, remainingPaise: wo.amountPaise - wo.billedPaise };
}
function milestoneDocs(ms) {
  return ms.map((m) => ({ ...m, dueDate: m.dueDate ? parseISODate(m.dueDate) : void 0 }));
}
async function createWorkOrder(ctx, input) {
  const projectId = await requireProject3(ctx, input.projectId);
  const vendor = await Vendor.findOne({ companyId: ctx.companyId, _id: toObjectId(input.vendorId), isActive: true }).lean();
  if (!vendor) throw badRequest("Vendor not found or inactive");
  return withTransaction(async (session) => {
    const number = await nextDocumentNumber(ctx.companyId, "WO", todayInIndia(), session);
    const [wo] = await WorkOrder.create(
      [
        {
          companyId: ctx.companyId,
          projectId,
          vendorId: vendor._id,
          number,
          title: input.title,
          scope: input.scope,
          amountPaise: input.amountPaise,
          startDate: input.startDate ? parseISODate(input.startDate) : void 0,
          endDate: input.endDate ? parseISODate(input.endDate) : void 0,
          milestones: milestoneDocs(input.milestones),
          status: "draft",
          createdBy: ctx.userId
        }
      ],
      { session }
    );
    await audit(
      ctx,
      {
        action: "construction.work_order_create",
        entityType: "work_order",
        entityId: wo._id,
        summary: `${number} ${vendor.name} ${formatINR(input.amountPaise)}`
      },
      session
    );
    return wo.toJSON();
  });
}
async function updateWorkOrder(ctx, id, input) {
  const wo = await WorkOrder.findOne({ companyId: ctx.companyId, _id: toObjectId(id) });
  if (!wo) throw notFound("Work order");
  assertProjectAccess(ctx, wo.projectId);
  if (wo.status === "completed" || wo.status === "cancelled") throw businessRule(`A ${wo.status} work order cannot be edited`);
  if (input.amountPaise !== void 0 && input.amountPaise < wo.billedPaise)
    throw businessRule(`Amount cannot be below the ${formatINR(wo.billedPaise)} already billed`);
  const { milestones, startDate, endDate, ...rest } = input;
  wo.set(rest);
  if (startDate !== void 0) wo.startDate = startDate ? parseISODate(startDate) : void 0;
  if (endDate !== void 0) wo.endDate = endDate ? parseISODate(endDate) : void 0;
  if (milestones) {
    const done = new Map(wo.milestones.map((m) => [m.name, m.completedAt]));
    wo.set(
      "milestones",
      milestoneDocs(milestones).map((m) => ({ ...m, completedAt: done.get(m.name) }))
    );
  }
  await wo.save();
  await audit(ctx, { action: "construction.work_order_update", entityType: "work_order", entityId: wo._id, changes: input });
  return wo.toJSON();
}
async function changeWorkOrderStatus(ctx, id, to, note) {
  const wo = await WorkOrder.findOne({ companyId: ctx.companyId, _id: toObjectId(id) }).lean();
  if (!wo) throw notFound("Work order");
  assertProjectAccess(ctx, wo.projectId);
  if (!WORK_ORDER_TRANSITIONS[wo.status].includes(to))
    throw businessRule(`A ${wo.status} work order cannot become ${to}`);
  if (to === "cancelled" && wo.billedPaise > 0) throw businessRule("Reverse the bills on this work order before cancelling it");
  const res = await WorkOrder.updateOne({ companyId: ctx.companyId, _id: wo._id, status: wo.status }, { $set: { status: to } });
  if (res.modifiedCount !== 1) throw businessRule("Work order changed concurrently, please retry");
  await audit(ctx, {
    action: "construction.work_order_status",
    entityType: "work_order",
    entityId: wo._id,
    changes: { from: wo.status, to, note }
  });
  return { id: String(wo._id), status: to };
}
async function setMilestone(ctx, id, milestoneId, completed, date) {
  const wo = await WorkOrder.findOne({ companyId: ctx.companyId, _id: toObjectId(id) });
  if (!wo) throw notFound("Work order");
  assertProjectAccess(ctx, wo.projectId);
  if (wo.status === "cancelled" || wo.status === "draft") throw businessRule("Issue the work order before recording progress");
  const m = wo.milestones.find((x) => String(x._id) === milestoneId);
  if (!m) throw notFound("Milestone");
  m.completedAt = completed ? parseISODate(date ?? todayInIndia()) : void 0;
  await wo.save();
  await audit(ctx, {
    action: "construction.milestone",
    entityType: "work_order",
    entityId: wo._id,
    changes: { milestone: m.name, completed }
  });
  return wo.toJSON();
}
async function listExpenses(ctx, q) {
  const filter = { companyId: ctx.companyId };
  if (q.projectId) {
    assertProjectAccess(ctx, q.projectId);
    filter.projectId = toObjectId(q.projectId);
  } else if (ctx.projectScope !== null) filter.projectId = { $in: ctx.projectScope };
  if (q.vendorId) filter.vendorId = toObjectId(q.vendorId);
  if (q.workOrderId) filter.workOrderId = toObjectId(q.workOrderId);
  if (q.from || q.to) filter.date = { ...q.from ? { $gte: parseISODate(q.from) } : {}, ...q.to ? { $lte: parseISODate(q.to) } : {} };
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), "i");
    filter.$or = [{ number: rx }, { description: rx }, { billNumber: rx }];
  }
  const sort = parseSort(q.sort, ["date", "amountPaise", "number", "createdAt"], { date: -1 });
  const [items, total, totals] = await Promise.all([
    Expense.find(filter).sort(sort).skip((q.page - 1) * q.pageSize).limit(q.pageSize).populate({ path: "vendorId", select: "name", match: { companyId: ctx.companyId } }).populate({ path: "projectId", select: "name code", match: { companyId: ctx.companyId } }).populate({ path: "expenseAccountId", select: "code name", match: { companyId: ctx.companyId } }).populate({ path: "workOrderId", select: "number title", match: { companyId: ctx.companyId } }).lean(),
    Expense.countDocuments(filter),
    Expense.aggregate([
      { $match: { ...filter, status: "posted" } },
      { $group: { _id: null, amount: { $sum: "$amountPaise" } } }
    ])
  ]);
  return { items, meta: pageMeta(q.page, q.pageSize, total), totalPaise: totals[0]?.amount ?? 0 };
}
async function createExpense(ctx, input) {
  return withTransaction(async (session) => {
    const c = ctx.companyId;
    let projectId;
    if (input.projectId) projectId = await requireProject3(ctx, input.projectId);
    else if (ctx.projectScope !== null) throw badRequest("Choose one of your projects");
    const account = await Account.findOne({ companyId: c, _id: toObjectId(input.expenseAccountId), isActive: true }).session(session).lean();
    const capitalised = account?.systemKey === "land_inventory";
    if (!account || account.type !== "expense" && !capitalised) throw badRequest("Choose an expense account (or Land & Development WIP)");
    if (account.systemKey && CONTROL_ACCOUNT_KEYS.includes(account.systemKey))
      throw badRequest("Control accounts cannot be used here");
    let vendorId;
    if (input.vendorId) {
      const vendor = await Vendor.findOne({ companyId: c, _id: toObjectId(input.vendorId) }).session(session).lean();
      if (!vendor) throw badRequest("Vendor not found");
      vendorId = vendor._id;
    }
    let workOrder;
    if (input.workOrderId) {
      const wo = await WorkOrder.findOne({ companyId: c, _id: toObjectId(input.workOrderId) }).session(session).lean();
      if (!wo) throw badRequest("Work order not found");
      if (!projectId || String(wo.projectId) !== String(projectId)) throw badRequest("The work order belongs to a different project");
      if (!vendorId || String(wo.vendorId) !== String(vendorId)) throw badRequest("The work order belongs to a different vendor");
      if (!["issued", "in_progress", "completed"].includes(wo.status))
        throw businessRule(`Bills cannot be booked against a ${wo.status} work order`);
      const upd = await WorkOrder.updateOne(
        { companyId: c, _id: wo._id, billedPaise: { $lte: wo.amountPaise - input.amountPaise } },
        { $inc: { billedPaise: input.amountPaise } },
        { session }
      );
      if (upd.modifiedCount !== 1)
        throw businessRule(`Bill exceeds the remaining ${formatINR(wo.amountPaise - wo.billedPaise)} on ${wo.number}`);
      workOrder = { _id: wo._id, number: wo.number };
    }
    const number = await nextDocumentNumber(c, "EXP", input.date, session);
    const expenseId = new Types11.ObjectId();
    const credit = input.settlement === "paid" ? {
      accountId: await resolveCashAccountFor(c, input.paidFromAccountId, input.mode ?? "neft", session),
      creditPaise: input.amountPaise
    } : {
      systemKey: "vendor_payable",
      creditPaise: input.amountPaise,
      vendorId,
      narration: input.billNumber ? `Bill ${input.billNumber}` : void 0
    };
    const je = await postJournal(
      ctx,
      {
        date: input.date,
        voucherType: input.settlement === "paid" ? "payment" : "journal",
        narration: `${number}: ${input.description}${workOrder ? ` (${workOrder.number})` : ""}`,
        reference: input.billNumber ?? number,
        projectId,
        lines: [{ accountId: account._id, debitPaise: input.amountPaise, narration: input.description }, credit],
        source: { type: "expense", id: expenseId },
        allowControlAccounts: input.settlement === "payable"
      },
      session
    );
    const [expense] = await Expense.create(
      [
        {
          _id: expenseId,
          companyId: c,
          number,
          projectId,
          vendorId,
          workOrderId: workOrder?._id,
          expenseAccountId: account._id,
          date: parseISODate(input.date),
          amountPaise: input.amountPaise,
          description: input.description,
          billNumber: input.billNumber,
          settlement: input.settlement,
          mode: input.settlement === "paid" ? input.mode ?? "neft" : void 0,
          paidFromAccountId: input.settlement === "paid" ? credit.accountId : void 0,
          journalEntryId: je._id,
          createdBy: ctx.userId
        }
      ],
      { session }
    );
    await audit(
      ctx,
      {
        action: "expenses.create",
        entityType: "expense",
        entityId: expenseId,
        summary: `${number} ${formatINR(input.amountPaise)} ${input.description}`
      },
      session
    );
    return expense.toJSON();
  });
}
async function reverseExpense(ctx, id, reason) {
  return withTransaction(async (session) => {
    const exp = await Expense.findOne({ companyId: ctx.companyId, _id: toObjectId(id) }).session(session).lean();
    if (!exp) throw notFound("Expense");
    if (exp.projectId) assertProjectAccess(ctx, exp.projectId);
    if (exp.status !== "posted") throw businessRule("This expense has already been reversed");
    if (exp.settlement === "payable" && exp.vendorId) {
      const balance = await partyBalance(ctx.companyId, { vendorId: exp.vendorId }, "vendor_payable", session);
      if (balance < exp.amountPaise) throw businessRule("This bill has already been paid; record a vendor refund or adjustment instead");
    }
    const rev = await reverseJournal(ctx, exp.journalEntryId, `Expense ${exp.number} reversed: ${reason}`, session, todayInIndia());
    const res = await Expense.updateOne(
      { companyId: ctx.companyId, _id: exp._id, status: "posted" },
      { $set: { status: "reversed", reversal: { reason, at: /* @__PURE__ */ new Date(), by: ctx.userId, journalEntryId: rev._id } } },
      { session }
    );
    if (res.modifiedCount !== 1) throw businessRule("This expense has already been reversed");
    if (exp.workOrderId)
      await WorkOrder.updateOne(
        { companyId: ctx.companyId, _id: exp.workOrderId },
        { $inc: { billedPaise: -exp.amountPaise } },
        { session }
      );
    await audit(
      ctx,
      { action: "expenses.reverse", entityType: "expense", entityId: exp._id, summary: exp.number, changes: { reason } },
      session
    );
    return { id: String(exp._id), status: "reversed" };
  });
}
async function payVendor(ctx, vendorId, input) {
  return withTransaction(async (session) => {
    const vendor = await Vendor.findOne({ companyId: ctx.companyId, _id: toObjectId(vendorId) }).session(session).lean();
    if (!vendor) throw notFound("Vendor");
    let projectId;
    if (input.projectId) projectId = await requireProject3(ctx, input.projectId);
    const balance = await partyBalance(ctx.companyId, { vendorId: vendor._id }, "vendor_payable", session);
    if (input.amountPaise > balance) throw businessRule(`Payment exceeds the ${formatINR(balance)} payable to ${vendor.name}`);
    const accountId = await resolveCashAccountFor(ctx.companyId, input.fromAccountId, input.mode, session);
    const number = await nextDocumentNumber(ctx.companyId, "VPV", input.paidOn, session);
    const paymentId = new Types11.ObjectId();
    const je = await postJournal(
      ctx,
      {
        date: input.paidOn,
        voucherType: "payment",
        narration: `Vendor payment ${number} to ${vendor.name}${input.reference ? ` (${input.reference})` : ""}`,
        reference: number,
        projectId,
        lines: [
          { systemKey: "vendor_payable", debitPaise: input.amountPaise, vendorId: vendor._id },
          { accountId, creditPaise: input.amountPaise }
        ],
        source: { type: "vendor_payment", id: paymentId },
        allowControlAccounts: true
      },
      session
    );
    const [payment] = await VendorPayment.create(
      [
        {
          _id: paymentId,
          companyId: ctx.companyId,
          number,
          vendorId: vendor._id,
          projectId,
          amountPaise: input.amountPaise,
          date: parseISODate(input.paidOn),
          mode: input.mode,
          accountId,
          reference: input.reference,
          remarks: input.remarks,
          journalEntryId: je._id,
          createdBy: ctx.userId
        }
      ],
      { session }
    );
    await audit(
      ctx,
      { action: "vendors.payment", entityType: "vendor", entityId: vendor._id, summary: `${number} ${formatINR(input.amountPaise)}` },
      session
    );
    return payment.toJSON();
  });
}
async function projectCosts(ctx, projectId) {
  const base2 = scopedFilter(ctx, projectId);
  const [land, orders, byAccount, byProject] = await Promise.all([
    LandPayment.aggregate([{ $match: base2 }, { $group: { _id: null, amount: { $sum: "$amountPaise" } } }]),
    WorkOrder.aggregate([
      { $match: { ...base2, status: { $ne: "cancelled" } } },
      {
        $group: {
          _id: null,
          committed: { $sum: "$amountPaise" },
          billed: { $sum: "$billedPaise" },
          open: { $sum: { $cond: [{ $in: ["$status", ["issued", "in_progress"]] }, 1, 0] } }
        }
      }
    ]),
    Expense.aggregate([
      { $match: { ...base2, status: "posted" } },
      { $group: { _id: "$expenseAccountId", amount: { $sum: "$amountPaise" } } }
    ]),
    Expense.aggregate([
      { $match: { ...base2, status: "posted" } },
      { $group: { _id: "$projectId", amount: { $sum: "$amountPaise" } } }
    ])
  ]);
  const accounts = await Account.find({ companyId: ctx.companyId, _id: { $in: byAccount.map((a) => a._id) } }).select("code name").lean();
  const projects = await Project.find({ companyId: ctx.companyId, _id: { $in: byProject.map((p) => p._id).filter(Boolean) } }).select("name code").lean();
  return {
    landPaidPaise: land[0]?.amount ?? 0,
    workOrders: { committedPaise: orders[0]?.committed ?? 0, billedPaise: orders[0]?.billed ?? 0, open: orders[0]?.open ?? 0 },
    expensesPaise: byAccount.reduce((s, a) => s + a.amount, 0),
    byAccount: byAccount.map((a) => ({
      accountId: String(a._id),
      ...accounts.find((x) => String(x._id) === String(a._id)) ?? { code: "", name: "Unknown" },
      amountPaise: a.amount
    })).sort((x, y) => y.amountPaise - x.amountPaise),
    byProject: byProject.map((p) => ({
      projectId: p._id ? String(p._id) : null,
      name: projects.find((x) => String(x._id) === String(p._id))?.name ?? "Company-wide",
      amountPaise: p.amount
    }))
  };
}

// src/modules/construction/construction.routes.ts
var vendorsRouter = Router8();
var vendorQuery = listQuerySchema.extend({
  category: z17.enum(VENDOR_CATEGORIES).optional(),
  includeInactive: z17.enum(["true", "false"]).transform((v) => v === "true").optional()
});
vendorsRouter.get("/", authorize("vendors.read"), validate({ query: vendorQuery }), async (req, res) => {
  const { items, meta: meta2 } = await listVendors(getCtx(req), query(req));
  ok(res, items, meta2);
});
vendorsRouter.post(
  "/",
  authorize("vendors.create"),
  validate({ body: vendorSchema }),
  async (req, res) => created(res, await createVendor(getCtx(req), body(req)))
);
vendorsRouter.get(
  "/:id",
  authorize("vendors.read"),
  validate({ params: idParam }),
  async (req, res) => ok(res, await getVendor(getCtx(req), params(req).id))
);
vendorsRouter.patch(
  "/:id",
  authorize("vendors.update"),
  validate({ params: idParam, body: patchSchema(vendorSchema) }),
  async (req, res) => ok(res, await updateVendor(getCtx(req), params(req).id, body(req)))
);
vendorsRouter.post(
  "/:id/payments",
  authorize("vendors.pay"),
  validate({ params: idParam, body: vendorPaymentSchema }),
  idempotent,
  async (req, res) => created(res, await payVendor(getCtx(req), params(req).id, body(req)))
);
var workOrdersRouter = Router8();
workOrdersRouter.get("/", authorize("construction.read"), validate({ query: workOrderListQuerySchema }), async (req, res) => {
  const { items, meta: meta2 } = await listWorkOrders(getCtx(req), query(req));
  ok(res, items, meta2);
});
workOrdersRouter.get(
  "/costs",
  authorize("construction.read"),
  validate({ query: z17.object({ projectId: objectId.optional() }) }),
  async (req, res) => ok(res, await projectCosts(getCtx(req), query(req).projectId))
);
workOrdersRouter.post(
  "/",
  authorize("construction.create"),
  validate({ body: workOrderSchema }),
  async (req, res) => created(res, await createWorkOrder(getCtx(req), body(req)))
);
workOrdersRouter.get(
  "/:id",
  authorize("construction.read"),
  validate({ params: idParam }),
  async (req, res) => ok(res, await getWorkOrder(getCtx(req), params(req).id))
);
workOrdersRouter.patch(
  "/:id",
  authorize("construction.update"),
  validate({ params: idParam, body: workOrderUpdateSchema }),
  async (req, res) => ok(res, await updateWorkOrder(getCtx(req), params(req).id, body(req)))
);
workOrdersRouter.post(
  "/:id/status",
  authorize("construction.update"),
  validate({ params: idParam, body: workOrderStatusSchema }),
  async (req, res) => {
    const b = body(req);
    ok(res, await changeWorkOrderStatus(getCtx(req), params(req).id, b.status, b.note));
  }
);
workOrdersRouter.post(
  "/:id/milestones/:milestoneId",
  authorize("construction.update"),
  validate({ params: z17.object({ id: objectId, milestoneId: objectId }), body: milestoneCompleteSchema }),
  async (req, res) => {
    const p = params(req);
    const b = body(req);
    ok(res, await setMilestone(getCtx(req), p.id, p.milestoneId, b.completed, b.date));
  }
);
var expensesRouter = Router8();
expensesRouter.get("/", authorize("expenses.read"), validate({ query: expenseListQuerySchema }), async (req, res) => {
  const { items, meta: meta2, totalPaise } = await listExpenses(getCtx(req), query(req));
  res.setHeader("x-total-amount", String(totalPaise));
  ok(res, items, meta2);
});
expensesRouter.post(
  "/",
  authorize("expenses.create"),
  validate({ body: expenseSchema }),
  idempotent,
  async (req, res) => created(res, await createExpense(getCtx(req), body(req)))
);
expensesRouter.post(
  "/:id/reverse",
  authorize("expenses.reverse"),
  validate({ params: idParam, body: z17.object({ reason: requiredText("Reason", 500) }) }),
  async (req, res) => ok(res, await reverseExpense(getCtx(req), params(req).id, body(req).reason))
);

// src/modules/crm/crm.routes.ts
import { Router as Router9 } from "express";
import { z as z18 } from "zod";

// src/modules/crm/lead-settings.ts
function defaultLeadSettings() {
  return {
    sources: LEAD_SOURCES.map((key) => ({ key, label: DEFAULT_LEAD_SOURCE_LABELS[key] ?? key, active: true })),
    stageLabels: { ...DEFAULT_LEAD_STAGE_LABELS },
    lostReasons: [...DEFAULT_LOST_REASONS]
  };
}
async function getLeadSettings(companyId) {
  const company = await Company.findById(companyId).select("leadSettings").lean();
  const saved = company?.leadSettings;
  const defaults = defaultLeadSettings();
  return {
    sources: saved?.sources?.length ? saved.sources : defaults.sources,
    stageLabels: { ...defaults.stageLabels, ...saved?.stageLabels ?? {} },
    lostReasons: saved?.lostReasons ?? defaults.lostReasons
  };
}
async function saveLeadSettings(companyId, input) {
  const sources = input.sources.some((s) => s.key === "other") ? input.sources : [...input.sources, { key: "other", label: "Other", active: true }];
  await Company.updateOne({ _id: companyId }, { $set: { leadSettings: { ...input, sources } } });
  return getLeadSettings(companyId);
}
async function assertLeadSource(companyId, source, isNew) {
  if (!source) return;
  const { sources } = await getLeadSettings(companyId);
  const found = sources.find((s) => s.key === source);
  if (!found || isNew && !found.active)
    throw badRequest("Choose one of the configured lead sources", [{ path: "source", message: "Unknown lead source" }]);
}

// src/modules/crm/crm.service.ts
function leadVisibility(ctx) {
  const f = { companyId: ctx.companyId, deletedAt: null };
  if (ctx.projectScope !== null) f.$or = [{ projectId: { $in: ctx.projectScope } }, { assignedTo: ctx.userId }, { createdBy: ctx.userId }];
  return f;
}
async function loadLead(ctx, id) {
  const lead = await Lead.findOne({ ...leadVisibility(ctx), _id: toObjectId(id) });
  if (!lead) throw notFound("Lead");
  return lead;
}
async function validateRefs(ctx, input) {
  const c = ctx.companyId;
  if (input.projectId) {
    assertProjectAccess(ctx, input.projectId);
    if (!await Project.exists({ companyId: c, _id: toObjectId(input.projectId) })) throw badRequest("Project not found");
  }
  if (input.brokerId && !await Broker.exists({ companyId: c, _id: toObjectId(input.brokerId) })) throw badRequest("Broker not found");
  if (input.assignedTo && !await Membership.exists({ companyId: c, userId: toObjectId(input.assignedTo), status: "active" })) {
    throw badRequest("Assignee is not an active member of this company");
  }
  if (input.interestedPlotIds?.length) {
    if (!input.projectId) throw badRequest("Choose the project for the plots of interest");
    const n = await Plot.countDocuments({
      companyId: c,
      projectId: toObjectId(input.projectId),
      _id: { $in: input.interestedPlotIds.map(toObjectId) }
    });
    if (n !== input.interestedPlotIds.length) throw badRequest("Some plots do not belong to the project");
  }
}
function normalize2(input) {
  const out = { ...input };
  if (input.nextFollowUpAt) out.nextFollowUpAt = new Date(input.nextFollowUpAt);
  if (input.interestedPlotIds) out.interestedPlotIds = input.interestedPlotIds.map(toObjectId);
  return out;
}
async function logActivity(ctx, leadId, type, summary, extra = {}) {
  await LeadActivity.create({ companyId: ctx.companyId, leadId, type, summary, actorId: ctx.userId, completedAt: /* @__PURE__ */ new Date(), ...extra });
}
async function notifyAssignee(ctx, lead, assignee) {
  if (String(assignee) === String(ctx.userId)) return;
  await Notification.create({
    companyId: ctx.companyId,
    userId: assignee,
    type: "lead_assigned",
    title: `New lead assigned: ${lead.name}`,
    link: `/pre-sales/leads?lead=${lead._id}`
  });
}
async function listLeads(ctx, q) {
  const and = [leadVisibility(ctx)];
  if (q.projectId) {
    assertProjectAccess(ctx, q.projectId);
    and.push({ projectId: toObjectId(q.projectId) });
  }
  if (q.status) and.push({ status: q.status });
  if (q.source) and.push({ source: q.source });
  if (q.assignedTo === "me") and.push({ assignedTo: ctx.userId });
  else if (q.assignedTo === "unassigned") and.push({ assignedTo: null });
  else if (q.assignedTo) and.push({ assignedTo: toObjectId(q.assignedTo) });
  if (q.followUp === "due") and.push({ status: { $in: OPEN_LEAD_STATUSES }, nextFollowUpAt: { $lte: /* @__PURE__ */ new Date() } });
  if (q.followUp === "upcoming") and.push({ status: { $in: OPEN_LEAD_STATUSES }, nextFollowUpAt: { $gt: /* @__PURE__ */ new Date() } });
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), "i");
    and.push({ $or: [{ name: rx }, { phone: rx }, { email: rx }] });
  }
  const filter = { $and: and, companyId: ctx.companyId };
  const sort = parseSort(q.sort, ["name", "createdAt", "nextFollowUpAt", "status", "lastActivityAt"], { createdAt: -1 });
  const [items, total] = await Promise.all([
    Lead.find(filter).sort(sort).skip((q.page - 1) * q.pageSize).limit(q.pageSize).populate("assignedTo", "name").populate({ path: "projectId", select: "name code", match: { companyId: ctx.companyId } }).lean(),
    Lead.countDocuments(filter)
  ]);
  return { items, meta: pageMeta(q.page, q.pageSize, total) };
}
async function leadSummary(ctx, projectId) {
  const match = { ...leadVisibility(ctx) };
  if (projectId) {
    assertProjectAccess(ctx, projectId);
    match.projectId = toObjectId(projectId);
  }
  const [byStatus, due, bySource] = await Promise.all([
    Lead.aggregate([{ $match: match }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
    Lead.countDocuments({ ...match, status: { $in: OPEN_LEAD_STATUSES }, nextFollowUpAt: { $lte: /* @__PURE__ */ new Date() } }),
    Lead.aggregate([
      { $match: match },
      { $group: { _id: "$source", n: { $sum: 1 }, won: { $sum: { $cond: [{ $eq: ["$status", "won"] }, 1, 0] } } } }
    ])
  ]);
  const counts = Object.fromEntries(byStatus.map((s) => [s._id, s.n]));
  const total = byStatus.reduce((a, s) => a + s.n, 0);
  const open = OPEN_LEAD_STATUSES.reduce((a, s) => a + (counts[s] ?? 0), 0);
  return {
    byStatus: counts,
    total,
    open,
    followUpsDue: due,
    conversionRateBp: total ? Math.round((counts.won ?? 0) * 1e4 / total) : 0,
    bySource
  };
}
async function getLead(ctx, id) {
  const lead = await Lead.findOne({ ...leadVisibility(ctx), _id: toObjectId(id) }).populate("assignedTo", "name email").populate({ path: "projectId", select: "name code", match: { companyId: ctx.companyId } }).populate({ path: "brokerId", select: "name phone", match: { companyId: ctx.companyId } }).populate({ path: "interestedPlotIds", select: "plotNumber status blockId", match: { companyId: ctx.companyId } }).populate({ path: "customerId", select: "name customerCode", match: { companyId: ctx.companyId } }).lean();
  if (!lead) throw notFound("Lead");
  const activities = await LeadActivity.find({ companyId: ctx.companyId, leadId: lead._id }).sort({ createdAt: -1 }).limit(200).populate("actorId", "name").lean();
  return { ...lead, activities };
}
async function createLead(ctx, input) {
  await validateRefs(ctx, input);
  await assertLeadSource(ctx.companyId, input.source, true);
  if (ctx.projectScope !== null && !input.projectId && !input.assignedTo) input.assignedTo = String(ctx.userId);
  const lead = await Lead.create({
    companyId: ctx.companyId,
    ...normalize2(input),
    status: "new",
    createdBy: ctx.userId,
    lastActivityAt: /* @__PURE__ */ new Date()
  });
  await logActivity(ctx, lead._id, "note", "Lead created");
  if (lead.assignedTo) await notifyAssignee(ctx, lead, lead.assignedTo);
  await audit(ctx, { action: "crm.create", entityType: "lead", entityId: lead._id, summary: lead.name });
  return lead.toJSON();
}
async function updateLead(ctx, id, input) {
  const lead = await loadLead(ctx, id);
  const { assignedTo: _ignored, ...rest } = input;
  await validateRefs(ctx, { ...rest, projectId: rest.projectId ?? (lead.projectId ? String(lead.projectId) : void 0) });
  if (rest.source !== void 0 && rest.source !== lead.source) await assertLeadSource(ctx.companyId, rest.source, true);
  lead.set(normalize2(rest));
  await lead.save();
  await audit(ctx, { action: "crm.update", entityType: "lead", entityId: lead._id, changes: rest });
  return lead.toJSON();
}
async function changeLeadStatus(ctx, id, status, lostReason) {
  const lead = await loadLead(ctx, id);
  if (status === "won" && !lead.customerId) throw businessRule("Convert the lead to a customer to mark it won");
  if (lead.status === "won" && status !== "won") throw businessRule("Won leads cannot be reopened");
  const from = lead.status;
  lead.status = status;
  lead.lostReason = status === "lost" ? lostReason : void 0;
  if (status === "lost") lead.nextFollowUpAt = void 0;
  lead.lastActivityAt = /* @__PURE__ */ new Date();
  await lead.save();
  await logActivity(ctx, lead._id, "status_change", `Status changed from ${from} to ${status}${lostReason ? `: ${lostReason}` : ""}`);
  await audit(ctx, { action: "crm.status_change", entityType: "lead", entityId: lead._id, changes: { from, to: status, lostReason } });
  return lead.toJSON();
}
async function addActivity(ctx, id, input) {
  const lead = await loadLead(ctx, id);
  if (lead.status === "won" || lead.status === "lost") {
    if (input.nextFollowUpAt) throw businessRule("Closed leads cannot have follow-ups");
  }
  await logActivity(ctx, lead._id, input.type, input.summary, { outcome: input.outcome });
  lead.lastActivityAt = /* @__PURE__ */ new Date();
  lead.nextFollowUpAt = input.nextFollowUpAt ? new Date(input.nextFollowUpAt) : void 0;
  if (lead.status === "new" && input.type !== "note") lead.status = "contacted";
  if (input.type === "site_visit" && (lead.status === "new" || lead.status === "contacted")) lead.status = "site_visit";
  await lead.save();
  return lead.toJSON();
}
async function assignLead(ctx, id, assignedTo) {
  const lead = await loadLead(ctx, id);
  if (assignedTo) await validateRefs(ctx, { assignedTo });
  lead.assignedTo = assignedTo ? toObjectId(assignedTo) : void 0;
  await lead.save();
  await logActivity(ctx, lead._id, "note", assignedTo ? "Lead reassigned" : "Lead unassigned");
  if (lead.assignedTo) await notifyAssignee(ctx, lead, lead.assignedTo);
  await audit(ctx, { action: "crm.assign", entityType: "lead", entityId: lead._id, changes: { assignedTo } });
  return lead.toJSON();
}
async function convertLead(ctx, id) {
  return withTransaction(async (session) => {
    const lead = await Lead.findOne({ ...leadVisibility(ctx), _id: toObjectId(id) }).session(session);
    if (!lead) throw notFound("Lead");
    if (lead.customerId) throw businessRule("This lead has already been converted");
    if (lead.status === "lost") throw businessRule("Reopen the lead before converting it");
    const existing = await Customer.findOne({ companyId: ctx.companyId, phone: lead.phone, deletedAt: null }).session(session).select("_id").lean();
    const linked = Boolean(existing);
    let customerId = existing?._id;
    if (!customerId) {
      const seq = await nextSequence(ctx.companyId, "customer", session);
      const [created2] = await Customer.create(
        [
          {
            companyId: ctx.companyId,
            customerCode: `C${String(seq).padStart(5, "0")}`,
            name: lead.name,
            phone: lead.phone,
            email: lead.email,
            leadId: lead._id,
            createdBy: ctx.userId
          }
        ],
        { session }
      );
      customerId = created2._id;
    }
    const res = await Lead.updateOne(
      { companyId: ctx.companyId, _id: lead._id, customerId: null },
      {
        $set: { customerId, status: "won", convertedAt: /* @__PURE__ */ new Date(), lastActivityAt: /* @__PURE__ */ new Date() },
        $unset: { nextFollowUpAt: 1 }
      },
      { session }
    );
    if (res.modifiedCount !== 1) throw businessRule("This lead has already been converted");
    await LeadActivity.create(
      [
        {
          companyId: ctx.companyId,
          leadId: lead._id,
          type: "status_change",
          summary: linked ? "Linked to existing customer and marked won" : "Converted to customer",
          actorId: ctx.userId,
          completedAt: /* @__PURE__ */ new Date()
        }
      ],
      { session }
    );
    await audit(
      ctx,
      {
        action: "crm.convert",
        entityType: "lead",
        entityId: lead._id,
        changes: { customerId: String(customerId), linkedExisting: linked }
      },
      session
    );
    return { leadId: String(lead._id), customerId: String(customerId), linkedExisting: linked };
  });
}
async function deleteLead(ctx, id) {
  const lead = await loadLead(ctx, id);
  await Lead.updateOne({ companyId: ctx.companyId, _id: lead._id }, { $set: { deletedAt: /* @__PURE__ */ new Date() } });
  await audit(ctx, { action: "crm.delete", entityType: "lead", entityId: lead._id, summary: lead.name });
}

// src/modules/crm/crm.routes.ts
var crmRouter = Router9();
crmRouter.get("/", authorize("crm.read"), validate({ query: leadListQuerySchema }), async (req, res) => {
  const { items, meta: meta2 } = await listLeads(getCtx(req), query(req));
  ok(res, items, meta2);
});
crmRouter.get(
  "/summary",
  authorize("crm.read"),
  validate({ query: z18.object({ projectId: objectId.optional() }) }),
  async (req, res) => ok(res, await leadSummary(getCtx(req), query(req).projectId))
);
crmRouter.post("/", authorize("crm.create"), validate({ body: leadSchema }), async (req, res) => {
  const ctx = getCtx(req);
  const input = body(req);
  if (input.assignedTo && input.assignedTo !== String(ctx.userId) && !ctx.permissions.has("crm.assign")) delete input.assignedTo;
  created(res, await createLead(ctx, input));
});
crmRouter.get(
  "/:id",
  authorize("crm.read"),
  validate({ params: idParam }),
  async (req, res) => ok(res, await getLead(getCtx(req), params(req).id))
);
crmRouter.patch(
  "/:id",
  authorize("crm.update"),
  validate({ params: idParam, body: leadUpdateSchema }),
  async (req, res) => ok(res, await updateLead(getCtx(req), params(req).id, body(req)))
);
crmRouter.post("/:id/status", authorize("crm.update"), validate({ params: idParam, body: leadStatusSchema }), async (req, res) => {
  const b = body(req);
  ok(res, await changeLeadStatus(getCtx(req), params(req).id, b.status, b.lostReason));
});
crmRouter.post(
  "/:id/activities",
  authorize("crm.update"),
  validate({ params: idParam, body: leadActivitySchema }),
  async (req, res) => created(res, await addActivity(getCtx(req), params(req).id, body(req)))
);
crmRouter.post(
  "/:id/assign",
  authorize("crm.assign"),
  validate({ params: idParam, body: leadAssignSchema }),
  async (req, res) => ok(res, await assignLead(getCtx(req), params(req).id, body(req).assignedTo))
);
crmRouter.post(
  "/:id/convert",
  authorize("crm.update", "customers.create"),
  validate({ params: idParam }),
  async (req, res) => ok(res, await convertLead(getCtx(req), params(req).id))
);
crmRouter.delete("/:id", authorize("crm.delete"), validate({ params: idParam }), async (req, res) => {
  await deleteLead(getCtx(req), params(req).id);
  ok(res, { deleted: true });
});

// src/modules/documents/documents.routes.ts
import { Router as Router10 } from "express";
import multer from "multer";
import { z as z19 } from "zod";

// src/modules/documents/documents.service.ts
import { createHash as createHash2, randomUUID as randomUUID2 } from "crypto";

// src/modules/documents/storage.ts
import { createHmac } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
function contentDisposition(fileName, disposition) {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
var signingKey = () => createHmac("sha256", env.JWT_ACCESS_SECRET).update("erp:file-url:v1").digest();
function signFileToken(payload) {
  const body2 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", signingKey()).update(body2).digest("base64url");
  return `${body2}.${sig}`;
}
function verifyFileToken(token) {
  const [body2, sig] = token.split(".");
  if (!body2 || !sig) return null;
  const expected = createHmac("sha256", signingKey()).update(body2).digest("base64url");
  if (!safeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body2, "base64url").toString("utf8"));
    if (typeof payload.e !== "number" || payload.e < Math.floor(Date.now() / 1e3)) return null;
    return payload;
  } catch {
    return null;
  }
}
var LocalDriver = class {
  root = path.resolve(env.STORAGE_LOCAL_DIR);
  resolve(key) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("Invalid storage key");
    return full;
  }
  async put(key, body2) {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body2, { mode: 384 });
  }
  async signedUrl(key, opts) {
    const token = signFileToken({
      k: key,
      n: opts.fileName,
      t: opts.mimeType,
      d: opts.disposition,
      e: Math.floor(Date.now() / 1e3) + opts.ttlSeconds
    });
    return `/api/v1/files/${token}`;
  }
  read(key) {
    return readFile(this.resolve(key));
  }
};
var S3Driver = class {
  client = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY } : void 0
  });
  async put(key, body2, mimeType) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: body2,
        ContentType: mimeType,
        ServerSideEncryption: env.S3_ENDPOINT ? void 0 : "AES256"
      })
    );
  }
  signedUrl(key, opts) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        ResponseContentType: opts.mimeType,
        ResponseContentDisposition: contentDisposition(opts.fileName, opts.disposition)
      }),
      { expiresIn: opts.ttlSeconds }
    );
  }
};
var localDriver = new LocalDriver();
var storage = env.STORAGE_DRIVER === "s3" ? new S3Driver() : localDriver;

// src/modules/documents/documents.service.ts
var ENTITY_PERMISSION = {
  project: "projects.read",
  land_parcel: "land.read",
  plot: "inventory.read",
  customer: "customers.read",
  booking: "bookings.read",
  payment: "payments.read",
  vendor: "vendors.read",
  work_order: "construction.read",
  lead: "crm.read",
  company: "company.read"
};
async function assertEntityAccess(ctx, entityType, entityId) {
  if (!hasPermission(ctx, ENTITY_PERMISSION[entityType])) throw forbidden();
  const id = toObjectId(entityId);
  const c = ctx.companyId;
  let projectId = null;
  let found = true;
  switch (entityType) {
    case "company":
      found = String(id) === String(c);
      break;
    case "project":
      found = Boolean(await Project.exists({ companyId: c, _id: id }));
      projectId = id;
      break;
    case "plot": {
      const r = await Plot.findOne({ companyId: c, _id: id }).select("projectId").lean();
      found = Boolean(r);
      projectId = r?.projectId;
      break;
    }
    case "booking": {
      const r = await Booking.findOne({ companyId: c, _id: id }).select("projectId").lean();
      found = Boolean(r);
      projectId = r?.projectId;
      break;
    }
    case "payment": {
      const r = await Payment.findOne({ companyId: c, _id: id }).select("projectId").lean();
      found = Boolean(r);
      projectId = r?.projectId;
      break;
    }
    case "work_order": {
      const r = await WorkOrder.findOne({ companyId: c, _id: id }).select("projectId").lean();
      found = Boolean(r);
      projectId = r?.projectId;
      break;
    }
    case "land_parcel": {
      const r = await LandParcel.findOne({ companyId: c, _id: id, deletedAt: null }).select("projectId").lean();
      found = Boolean(r);
      projectId = r?.projectId ?? null;
      if (r && !projectId && ctx.projectScope !== null) found = false;
      break;
    }
    case "lead": {
      const r = await Lead.findOne({ companyId: c, _id: id, deletedAt: null }).select("projectId assignedTo createdBy").lean();
      found = Boolean(r);
      projectId = r?.projectId ?? null;
      if (r && ctx.projectScope !== null) {
        const mine = String(r.assignedTo) === String(ctx.userId) || String(r.createdBy) === String(ctx.userId);
        if (!mine && !(projectId && canAccessProject(ctx, projectId))) found = false;
        projectId = null;
      }
      break;
    }
    case "vendor":
      found = Boolean(await Vendor.exists({ companyId: c, _id: id }));
      break;
    case "customer":
      await assertCustomerVisible(ctx, entityId);
      break;
  }
  if (!found) throw notFound("Record");
  if (projectId && !canAccessProject(ctx, projectId)) throw notFound("Record");
  return projectId ?? null;
}
function matchesSignature(buf, mimeType) {
  const startsWith = (...bytes) => bytes.every((b, i) => buf[i] === b);
  switch (mimeType) {
    case "application/pdf":
      return buf.subarray(0, 5).toString("latin1") === "%PDF-";
    case "image/png":
      return startsWith(137, 80, 78, 71, 13, 10, 26, 10);
    case "image/jpeg":
      return startsWith(255, 216, 255);
    case "image/webp":
      return buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return startsWith(80, 75, 3, 4) && buf.includes("word/");
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return startsWith(80, 75, 3, 4) && buf.includes("xl/");
    default:
      return false;
  }
}
function safeFileName(name) {
  const base2 = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base2.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_").trim();
  return (cleaned || "file").slice(0, 180);
}
async function uploadDocument(ctx, input, file) {
  if (!file) throw badRequest("Attach a file");
  if (file.size === 0) throw badRequest("The file is empty");
  if (file.size > env.MAX_UPLOAD_MB * 1024 * 1024)
    throw new AppError(413, "VALIDATION_ERROR", `Files may be at most ${env.MAX_UPLOAD_MB} MB`);
  const ext = ALLOWED_UPLOAD_TYPES[file.mimetype];
  if (!ext) throw badRequest("Only PDF, PNG, JPEG, WebP, Word (.docx) and Excel (.xlsx) files are allowed");
  if (!matchesSignature(file.buffer, file.mimetype)) throw badRequest("The file contents do not match its type");
  const projectId = await assertEntityAccess(ctx, input.entityType, input.entityId);
  const storageKey = `${ctx.companyId}/${input.entityType}/${input.entityId}/${randomUUID2()}.${ext}`;
  const checksumSha256 = createHash2("sha256").update(file.buffer).digest("hex");
  await storage.put(storageKey, file.buffer, file.mimetype);
  const doc = await DocumentFile.create({
    companyId: ctx.companyId,
    projectId,
    entityType: input.entityType,
    entityId: toObjectId(input.entityId),
    category: input.category,
    description: input.description,
    fileName: safeFileName(file.originalname),
    mimeType: file.mimetype,
    sizeBytes: file.size,
    storageKey,
    checksumSha256,
    uploadedBy: ctx.userId
  });
  await audit(ctx, {
    action: "documents.upload",
    entityType: input.entityType,
    entityId: input.entityId,
    summary: `${doc.fileName} (${input.category})`,
    changes: { documentId: String(doc._id), sizeBytes: file.size, checksumSha256 }
  });
  return doc.toJSON();
}
async function listDocuments(ctx, entityType, entityId) {
  await assertEntityAccess(ctx, entityType, entityId);
  return DocumentFile.find({ companyId: ctx.companyId, entityType, entityId: toObjectId(entityId), deletedAt: null }).sort({ createdAt: -1 }).populate("uploadedBy", "name").lean();
}
async function documentUrl(ctx, id, disposition) {
  const doc = await DocumentFile.findOne({ companyId: ctx.companyId, _id: toObjectId(id), deletedAt: null }).select("+storageKey").lean();
  if (!doc) throw notFound("Document");
  await assertEntityAccess(ctx, doc.entityType, String(doc.entityId));
  const ttl = env.FILE_URL_TTL_SECONDS;
  const url = await storage.signedUrl(doc.storageKey, { fileName: doc.fileName, mimeType: doc.mimeType, ttlSeconds: ttl, disposition });
  await audit(ctx, { action: "documents.download", entityType: doc.entityType, entityId: doc.entityId, summary: doc.fileName });
  return { url, expiresAt: new Date(Date.now() + ttl * 1e3).toISOString(), fileName: doc.fileName, mimeType: doc.mimeType };
}
async function deleteDocument(ctx, id) {
  const doc = await DocumentFile.findOne({ companyId: ctx.companyId, _id: toObjectId(id), deletedAt: null }).lean();
  if (!doc) throw notFound("Document");
  await assertEntityAccess(ctx, doc.entityType, String(doc.entityId));
  await DocumentFile.updateOne({ companyId: ctx.companyId, _id: doc._id }, { $set: { deletedAt: /* @__PURE__ */ new Date(), deletedBy: ctx.userId } });
  await audit(ctx, { action: "documents.delete", entityType: doc.entityType, entityId: doc.entityId, summary: doc.fileName });
}

// src/modules/documents/documents.routes.ts
var upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 10, fieldSize: 2048 }
});
var documentsRouter = Router10();
documentsRouter.get("/", authorize("documents.read"), validate({ query: documentListQuerySchema }), async (req, res) => {
  const q = query(req);
  ok(res, await listDocuments(getCtx(req), q.entityType, q.entityId));
});
documentsRouter.post(
  "/",
  authorize("documents.upload"),
  (req, res, next) => upload.single("file")(req, res, (err) => {
    if (err?.code === "LIMIT_FILE_SIZE")
      return next(new AppError(413, "VALIDATION_ERROR", `Files may be at most ${env.MAX_UPLOAD_MB} MB`));
    if (err) return next(new AppError(400, "VALIDATION_ERROR", 'Upload a single file in the "file" field'));
    next();
  }),
  async (req, res) => {
    const input = documentUploadSchema.parse(req.body);
    created(res, await uploadDocument(getCtx(req), input, req.file));
  }
);
documentsRouter.get(
  "/:id/url",
  authorize("documents.read"),
  validate({ params: idParam, query: z19.object({ disposition: z19.enum(["inline", "attachment"]).default("attachment") }) }),
  async (req, res) => ok(
    res,
    await documentUrl(getCtx(req), params(req).id, query(req).disposition)
  )
);
documentsRouter.delete("/:id", authorize("documents.delete"), validate({ params: idParam }), async (req, res) => {
  await deleteDocument(getCtx(req), params(req).id);
  ok(res, { deleted: true });
});
var filesRouter = Router10();
filesRouter.get("/:token", async (req, res) => {
  const payload = verifyFileToken(req.params.token);
  if (!payload) throw new AppError(403, "FORBIDDEN", "This link is invalid or has expired");
  const body2 = await localDriver.read(payload.k).catch(() => null);
  if (!body2) throw new AppError(404, "NOT_FOUND", "File not found");
  res.setHeader("Content-Type", payload.t);
  res.setHeader("Content-Disposition", contentDisposition(payload.n, payload.d));
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.send(body2);
});

// src/modules/land/land.routes.ts
import { Router as Router11 } from "express";

// src/modules/land/land.service.ts
import { Types as Types12 } from "mongoose";
function visibility(ctx) {
  const f = { companyId: ctx.companyId, deletedAt: null };
  if (ctx.projectScope !== null) f.projectId = { $in: ctx.projectScope };
  return f;
}
async function loadParcel(ctx, id) {
  const parcel = await LandParcel.findOne({ ...visibility(ctx), _id: toObjectId(id) });
  if (!parcel) throw notFound("Land parcel");
  return parcel;
}
async function checkProject(ctx, projectId) {
  if (!projectId) {
    if (ctx.projectScope !== null) throw badRequest("Link the parcel to one of your projects");
    return null;
  }
  assertProjectAccess(ctx, projectId);
  if (!await Project.exists({ companyId: ctx.companyId, _id: toObjectId(projectId) })) throw badRequest("Project not found");
  return toObjectId(projectId);
}
function dates(input) {
  const out = { ...input };
  for (const k of ["agreementDate", "registryDate"]) if (input[k]) out[k] = parseISODate(input[k]);
  return out;
}
async function listParcels(ctx, q) {
  const filter = visibility(ctx);
  if (q.projectId) {
    assertProjectAccess(ctx, q.projectId);
    filter.projectId = toObjectId(q.projectId);
  }
  if (q.status) filter.status = q.status;
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), "i");
    filter.$or = [{ khasraNumber: rx }, { village: rx }, { "owners.name": rx }, { district: rx }];
  }
  const sort = parseSort(q.sort, ["khasraNumber", "village", "status", "createdAt", "agreedCostPaise"], { createdAt: -1 });
  const [items, total, totals] = await Promise.all([
    LandParcel.find(filter).sort(sort).skip((q.page - 1) * q.pageSize).limit(q.pageSize).select("-statusHistory").populate({ path: "projectId", select: "name code", match: { companyId: ctx.companyId } }).lean(),
    LandParcel.countDocuments(filter),
    LandParcel.aggregate([
      { $match: { ...filter, status: { $ne: "dropped" } } },
      { $group: { _id: null, agreed: { $sum: { $ifNull: ["$agreedCostPaise", 0] } }, paid: { $sum: "$paidPaise" }, count: { $sum: 1 } } }
    ])
  ]);
  return {
    items,
    meta: pageMeta(q.page, q.pageSize, total),
    totals: { agreedCostPaise: totals[0]?.agreed ?? 0, paidPaise: totals[0]?.paid ?? 0, parcels: totals[0]?.count ?? 0 }
  };
}
async function getParcel(ctx, id) {
  const parcel = await LandParcel.findOne({ ...visibility(ctx), _id: toObjectId(id) }).populate({ path: "projectId", select: "name code", match: { companyId: ctx.companyId } }).populate("statusHistory.by", "name").lean();
  if (!parcel) throw notFound("Land parcel");
  const payments = await LandPayment.find({ companyId: ctx.companyId, landParcelId: parcel._id }).sort({ date: 1, createdAt: 1 }).populate({ path: "accountId", select: "code name", match: { companyId: ctx.companyId } }).lean();
  return { ...parcel, payments, balancePaise: parcel.agreedCostPaise ? parcel.agreedCostPaise - parcel.paidPaise : null };
}
async function createParcel(ctx, input) {
  const projectId = await checkProject(ctx, input.projectId);
  const parcel = await LandParcel.create({
    companyId: ctx.companyId,
    ...dates(input),
    projectId,
    status: "negotiation",
    statusHistory: [{ from: null, to: "negotiation", note: "Parcel recorded", by: ctx.userId }],
    createdBy: ctx.userId
  });
  await audit(ctx, {
    action: "land.create",
    entityType: "land_parcel",
    entityId: parcel._id,
    summary: `Khasra ${parcel.khasraNumber}, ${parcel.village}`
  });
  return parcel.toJSON();
}
async function updateParcel(ctx, id, input) {
  const parcel = await loadParcel(ctx, id);
  if (input.projectId !== void 0) parcel.projectId = await checkProject(ctx, input.projectId);
  if (input.agreedCostPaise !== void 0 && input.agreedCostPaise < parcel.paidPaise) {
    throw businessRule(`Agreed cost cannot be below the ${formatINR(parcel.paidPaise)} already paid`);
  }
  const { projectId: _p, ...rest } = dates(input);
  parcel.set(rest);
  await parcel.save();
  await audit(ctx, { action: "land.update", entityType: "land_parcel", entityId: parcel._id, changes: input });
  return parcel.toJSON();
}
async function changeStatus(ctx, id, to, date, note) {
  const parcel = await loadParcel(ctx, id);
  const from = parcel.status;
  if (!LAND_TRANSITIONS[from].includes(to)) throw businessRule(`A parcel in ${from} cannot move to ${to}`);
  if (to === "dropped" && parcel.paidPaise > 0) throw businessRule("Parcels with payments to owners cannot be dropped");
  const when = parseISODate(date ?? todayInIndia());
  const set = { status: to };
  if (to === "agreement" && !parcel.agreementDate) set.agreementDate = when;
  if (to === "registered" && !parcel.registryDate) set.registryDate = when;
  const res = await LandParcel.updateOne(
    { companyId: ctx.companyId, _id: parcel._id, status: from },
    { $set: set, $push: { statusHistory: { from, to, note, at: /* @__PURE__ */ new Date(), by: ctx.userId } } }
  );
  if (res.modifiedCount !== 1) throw businessRule("The parcel changed concurrently, please retry");
  await audit(ctx, { action: "land.status_change", entityType: "land_parcel", entityId: parcel._id, changes: { from, to, note } });
  return { id: String(parcel._id), status: to };
}
async function recordLandPayment(ctx, id, input) {
  return withTransaction(async (session) => {
    const parcel = await LandParcel.findOne({ ...visibility(ctx), _id: toObjectId(id) }).session(session).lean();
    if (!parcel) throw notFound("Land parcel");
    if (parcel.status === "dropped" || parcel.status === "negotiation") {
      throw businessRule("Record the agreement before paying land owners");
    }
    if (parcel.agreedCostPaise && parcel.paidPaise + input.amountPaise > parcel.agreedCostPaise) {
      throw businessRule(`Payment exceeds the balance of ${formatINR(parcel.agreedCostPaise - parcel.paidPaise)} on the agreed cost`);
    }
    const accountId = await resolveCashAccountFor(ctx.companyId, input.fromAccountId, input.mode, session);
    const number = await nextDocumentNumber(ctx.companyId, "LPV", input.paidOn, session);
    const paymentId = new Types12.ObjectId();
    const je = await postJournal(
      ctx,
      {
        date: input.paidOn,
        voucherType: "payment",
        narration: `Land payment ${number}: khasra ${parcel.khasraNumber}, ${parcel.village}${input.payee ? ` to ${input.payee}` : ""}`,
        reference: number,
        projectId: parcel.projectId ?? void 0,
        lines: [
          { systemKey: "land_inventory", debitPaise: input.amountPaise, narration: `Khasra ${parcel.khasraNumber}` },
          { accountId, creditPaise: input.amountPaise }
        ],
        source: { type: "land_payment", id: paymentId }
      },
      session
    );
    const cap = parcel.agreedCostPaise ? { paidPaise: { $lte: parcel.agreedCostPaise - input.amountPaise } } : {};
    const upd = await LandParcel.updateOne(
      { companyId: ctx.companyId, _id: parcel._id, ...cap },
      { $inc: { paidPaise: input.amountPaise } },
      { session }
    );
    if (upd.modifiedCount !== 1) throw businessRule("Payment exceeds the remaining agreed cost");
    const [payment] = await LandPayment.create(
      [
        {
          _id: paymentId,
          companyId: ctx.companyId,
          number,
          landParcelId: parcel._id,
          projectId: parcel.projectId,
          amountPaise: input.amountPaise,
          date: parseISODate(input.paidOn),
          mode: input.mode,
          accountId,
          payee: input.payee,
          reference: input.reference,
          remarks: input.remarks,
          journalEntryId: je._id,
          createdBy: ctx.userId
        }
      ],
      { session }
    );
    await audit(
      ctx,
      { action: "land.payment", entityType: "land_parcel", entityId: parcel._id, summary: `${number} ${formatINR(input.amountPaise)}` },
      session
    );
    return payment.toJSON();
  });
}
async function deleteParcel(ctx, id) {
  const parcel = await loadParcel(ctx, id);
  if (parcel.paidPaise > 0) throw businessRule("Parcels with payments cannot be deleted");
  await LandParcel.updateOne({ companyId: ctx.companyId, _id: parcel._id }, { $set: { deletedAt: /* @__PURE__ */ new Date() } });
  await audit(ctx, { action: "land.delete", entityType: "land_parcel", entityId: parcel._id });
}

// src/modules/land/land.routes.ts
var landRouter = Router11();
landRouter.get("/", authorize("land.read"), validate({ query: landListQuerySchema }), async (req, res) => {
  const { items, meta: meta2 } = await listParcels(getCtx(req), query(req));
  ok(res, items, meta2);
});
landRouter.get("/summary", authorize("land.read"), validate({ query: landListQuerySchema }), async (req, res) => {
  const { totals } = await listParcels(getCtx(req), { ...query(req), page: 1, pageSize: 1 });
  ok(res, totals);
});
landRouter.post(
  "/",
  authorize("land.create"),
  validate({ body: landParcelSchema }),
  async (req, res) => created(res, await createParcel(getCtx(req), body(req)))
);
landRouter.get(
  "/:id",
  authorize("land.read"),
  validate({ params: idParam }),
  async (req, res) => ok(res, await getParcel(getCtx(req), params(req).id))
);
landRouter.patch(
  "/:id",
  authorize("land.update"),
  validate({ params: idParam, body: landParcelUpdateSchema }),
  async (req, res) => ok(res, await updateParcel(getCtx(req), params(req).id, body(req)))
);
landRouter.post("/:id/status", authorize("land.update"), validate({ params: idParam, body: landStatusSchema }), async (req, res) => {
  const b = body(req);
  ok(res, await changeStatus(getCtx(req), params(req).id, b.status, b.date, b.note));
});
landRouter.post(
  "/:id/payments",
  authorize("land.pay"),
  validate({ params: idParam, body: landPaymentSchema }),
  idempotent,
  async (req, res) => created(res, await recordLandPayment(getCtx(req), params(req).id, body(req)))
);
landRouter.delete("/:id", authorize("land.delete"), validate({ params: idParam }), async (req, res) => {
  await deleteParcel(getCtx(req), params(req).id);
  ok(res, { deleted: true });
});

// src/modules/masters/masters.routes.ts
import { Router as Router13 } from "express";
import { z as z20 } from "zod";

// src/modules/masters/crud.ts
import { Router as Router12 } from "express";
function masterVisibility(ctx, opts) {
  const f = { companyId: ctx.companyId, deletedAt: null };
  const pf = opts.projectField;
  if (pf && ctx.projectScope !== null) {
    const inScope = { $in: ctx.projectScope };
    if (pf.many) f.$or = [{ [pf.name]: { $size: 0 } }, { [pf.name]: inScope }];
    else if (pf.allowNull) f.$or = [{ [pf.name]: null }, { [pf.name]: inScope }];
    else f[pf.name] = inScope;
  }
  return f;
}
async function assertRefs(ctx, model23, ids, label, opts = {}) {
  const list = [...new Set((ids ?? []).filter((x) => !!x))];
  if (!list.length) return [];
  if (opts.project) list.forEach((id) => assertProjectAccess(ctx, id));
  const oids = list.map(toObjectId);
  const n = await model23.countDocuments({ companyId: ctx.companyId, _id: { $in: oids } });
  if (n !== oids.length) throw badRequest(`${label} not found`);
  return oids;
}
function withMatch(ctx, populate = []) {
  return populate.map((p) => ({ ...p, match: { ...p.match, companyId: ctx.companyId } }));
}
function crudRouter(opts) {
  const router = Router12();
  const { model: model23, permissions: perm } = opts;
  async function load2(ctx, id) {
    const doc = await model23.findOne({ ...masterVisibility(ctx, opts), _id: toObjectId(id) });
    if (!doc) throw notFound(opts.entity);
    return doc;
  }
  opts.extend?.(router);
  router.get("/", authorize(perm.read), validate({ query: masterListQuerySchema }), async (req, res) => {
    const ctx = getCtx(req);
    const q = query(req);
    const filter = { ...masterVisibility(ctx, opts), ...opts.filter?.(q) ?? {} };
    if (q.active) filter.isActive = q.active === "true";
    if (q.projectId && opts.projectField) {
      assertProjectAccess(ctx, q.projectId);
      const pid2 = toObjectId(q.projectId);
      const cond = opts.projectField.allowNull ? { $in: [pid2, null] } : pid2;
      filter.$and = [...filter.$and ?? [], { [opts.projectField.name]: cond }];
    }
    if (q.q) {
      const rx = new RegExp(escapeRegex(q.q), "i");
      filter.$and = [...filter.$and ?? [], { $or: opts.searchFields.map((f) => ({ [f]: rx })) }];
    }
    const sort = parseSort(q.sort, opts.sortFields, opts.defaultSort);
    const [rows, total] = await Promise.all([
      model23.find(filter).sort(sort).skip((q.page - 1) * q.pageSize).limit(q.pageSize).populate(withMatch(ctx, opts.populate)).lean(),
      model23.countDocuments(filter)
    ]);
    ok(res, opts.enrich ? await opts.enrich(ctx, rows) : rows, pageMeta(q.page, q.pageSize, total));
  });
  router.get("/:id", authorize(perm.read), validate({ params: idParam }), async (req, res) => {
    const ctx = getCtx(req);
    const doc = await model23.findOne({ ...masterVisibility(ctx, opts), _id: toObjectId(params(req).id) }).populate(withMatch(ctx, opts.populate)).lean();
    if (!doc) throw notFound(opts.entity);
    ok(res, opts.detail ? await opts.detail(ctx, doc) : doc);
  });
  router.post("/", authorize(perm.create), validate({ body: opts.createSchema }), async (req, res) => {
    const ctx = getCtx(req);
    const input = body(req);
    const data = opts.prepare ? await opts.prepare(ctx, input) : input;
    const doc = await model23.create({ ...data, companyId: ctx.companyId, createdBy: ctx.userId });
    await audit(ctx, {
      action: `${opts.auditType}.create`,
      entityType: opts.auditType,
      entityId: doc._id,
      summary: String(doc.name ?? doc.code ?? "")
    });
    created(res, doc.toJSON());
  });
  router.patch("/:id", authorize(perm.update), validate({ params: idParam, body: opts.updateSchema }), async (req, res) => {
    const ctx = getCtx(req);
    const doc = await load2(ctx, params(req).id);
    const input = body(req);
    const data = opts.prepare ? await opts.prepare(ctx, input, doc.toObject()) : input;
    doc.set(data);
    await doc.save();
    await audit(ctx, { action: `${opts.auditType}.update`, entityType: opts.auditType, entityId: doc._id, changes: input });
    ok(res, doc.toJSON());
  });
  router.delete("/:id", authorize(perm.delete), validate({ params: idParam }), async (req, res) => {
    const ctx = getCtx(req);
    const doc = await load2(ctx, params(req).id);
    await opts.beforeDelete?.(ctx, doc.toObject());
    if ("deletedAt" in model23.schema.paths)
      await model23.updateOne({ companyId: ctx.companyId, _id: doc._id }, { $set: { deletedAt: /* @__PURE__ */ new Date() } });
    else await model23.deleteOne({ companyId: ctx.companyId, _id: doc._id });
    await audit(ctx, { action: `${opts.auditType}.delete`, entityType: opts.auditType, entityId: doc._id });
    ok(res, { deleted: true });
  });
  return router;
}

// src/modules/masters/masters.service.ts
async function enrichFinancers(ctx, rows) {
  const ids = rows.map((r) => r._id);
  const stats = await Booking.aggregate([
    { $match: { companyId: ctx.companyId, "loan.financerId": { $in: ids }, status: { $in: ["reserved", "booked"] } } },
    {
      $group: {
        _id: "$loan.financerId",
        count: { $sum: 1 },
        sanctioned: { $sum: { $ifNull: ["$loan.sanctionedPaise", 0] } },
        disbursed: { $sum: { $ifNull: ["$loan.disbursedPaise", 0] } }
      }
    }
  ]);
  const byId = new Map(stats.map((s) => [String(s._id), s]));
  return rows.map((r) => {
    const s = byId.get(String(r._id));
    return { ...r, loans: s?.count ?? 0, sanctionedPaise: s?.sanctioned ?? 0, disbursedPaise: s?.disbursed ?? 0 };
  });
}
async function financerDetail(ctx, doc) {
  const filter = { ...scopedFilter(ctx), "loan.financerId": doc._id };
  const bookings = await Booking.find(filter).sort({ bookingDate: -1 }).limit(200).select("bookingNumber status bookingDate netAmountPaise receivedPaise loan customerId projectId").populate({ path: "customerId", select: "name phone", match: { companyId: ctx.companyId } }).populate({ path: "projectId", select: "name code", match: { companyId: ctx.companyId } }).lean();
  return { ...doc, bookings };
}
async function computeCharges(ctx, projectId, plotIds) {
  assertProjectAccess(ctx, projectId);
  const pid2 = toObjectId(projectId);
  const plots = plotIds.length ? await Plot.find({ companyId: ctx.companyId, projectId: pid2, _id: { $in: plotIds.map(toObjectId) } }).select("areaX100 ratePaisePerSqft plcBp").lean() : [];
  const areaX100 = plots.reduce((s, p) => s + p.areaX100, 0);
  const valuePaise = plots.reduce((s, p) => {
    const base2 = priceForArea(p.areaX100, p.ratePaisePerSqft);
    return s + base2 + applyBasisPoints(base2, p.plcBp);
  }, 0);
  const charges = await ChargeMaster.find({ companyId: ctx.companyId, deletedAt: null, isActive: true, projectId: { $in: [pid2, null] } }).sort({ kind: 1, name: 1 }).lean();
  return charges.map((c) => {
    const base2 = c.basis === "fixed" ? c.value * Math.max(plots.length, 1) : c.basis === "per_sqft" ? priceForArea(areaX100, c.value) : applyBasisPoints(valuePaise, c.value);
    const gstPaise = applyBasisPoints(base2, c.gstBp ?? 0);
    return {
      id: String(c._id),
      name: c.gstBp ? `${c.name} (incl. GST)` : c.name,
      kind: c.kind,
      basis: c.basis,
      isMandatory: c.isMandatory,
      amountPaise: base2 + gstPaise,
      basePaise: base2,
      gstPaise
    };
  });
}
async function applyRateIndex(ctx, id, dryRun) {
  const idx = await RateIndex.findOne({ companyId: ctx.companyId, deletedAt: null, _id: toObjectId(id) }).lean();
  if (!idx) throw notFound("Rate index");
  assertProjectAccess(ctx, idx.projectId);
  const filter = {
    companyId: ctx.companyId,
    projectId: idx.projectId,
    deletedAt: null,
    status: { $in: ["available", "blocked"] }
  };
  if (idx.phaseId) filter.phaseId = idx.phaseId;
  if (idx.blockId) filter.blockId = idx.blockId;
  if (idx.unitType) filter.unitType = idx.unitType;
  if (idx.category) filter.category = idx.category;
  const plots = await Plot.find(filter).select("areaX100 ratePaisePerSqft plcBp listPricePaise").lean();
  const changes = plots.map((p) => {
    const plcBp = idx.plcBp ?? p.plcBp;
    return { id: p._id, plcBp, before: p.listPricePaise, after: computeListPrice(p.areaX100, idx.ratePaisePerSqft, plcBp) };
  });
  const summary = {
    units: changes.length,
    valueBeforePaise: changes.reduce((s, c) => s + c.before, 0),
    valueAfterPaise: changes.reduce((s, c) => s + c.after, 0)
  };
  if (dryRun || !changes.length) return { ...summary, applied: false };
  await Plot.bulkWrite(
    changes.map((c) => ({
      updateOne: {
        filter: { companyId: ctx.companyId, _id: c.id, status: { $in: ["available", "blocked"] } },
        update: { $set: { ratePaisePerSqft: idx.ratePaisePerSqft, plcBp: c.plcBp, listPricePaise: c.after } }
      }
    }))
  );
  await RateIndex.updateOne(
    { companyId: ctx.companyId, _id: idx._id },
    { $push: { applications: { at: /* @__PURE__ */ new Date(), by: ctx.userId, unitsRepriced: changes.length } } }
  );
  await audit(ctx, {
    action: "rate_index.apply",
    entityType: "rate_index",
    entityId: idx._id,
    summary: `${idx.name}: ${changes.length} units repriced to ${formatINR(idx.ratePaisePerSqft)}/sq ft`
  });
  return { ...summary, applied: true };
}
async function listParking(ctx, q) {
  const filter = scopedFilter(ctx, q.projectId);
  const base2 = { ...filter };
  if (q.status) filter.status = q.status;
  if (q.type) filter.type = q.type;
  if (q.q) filter.code = new RegExp(escapeRegex(q.q), "i");
  const sort = parseSort(q.sort, ["code", "type", "status", "pricePaise", "createdAt"], { code: 1 });
  const [items, total, counts] = await Promise.all([
    ParkingSlot.find(filter).collation({ locale: "en", numericOrdering: true }).sort(sort).skip((q.page - 1) * q.pageSize).limit(q.pageSize).select("-history").populate({ path: "projectId", select: "name code", match: { companyId: ctx.companyId } }).populate({ path: "blockId", select: "name code", match: { companyId: ctx.companyId } }).populate({ path: "bookingId", select: "bookingNumber status", match: { companyId: ctx.companyId } }).populate({ path: "customerId", select: "name phone", match: { companyId: ctx.companyId } }).lean(),
    ParkingSlot.countDocuments(filter),
    ParkingSlot.aggregate([{ $match: base2 }, { $group: { _id: "$status", n: { $sum: 1 } } }])
  ]);
  const summary = { available: 0, allotted: 0, blocked: 0, total: 0 };
  for (const c of counts) {
    summary[c._id] = c.n;
    summary.total += c.n;
  }
  return { items, meta: pageMeta(q.page, q.pageSize, total), summary };
}
async function checkParkingRefs(ctx, projectId, blockId) {
  assertProjectAccess(ctx, projectId);
  const pid2 = toObjectId(projectId);
  if (!await Project.exists({ companyId: ctx.companyId, _id: pid2 })) throw badRequest("Project not found");
  if (blockId && !await Block.exists({ companyId: ctx.companyId, projectId: pid2, _id: toObjectId(blockId) })) {
    throw badRequest("Tower / block does not belong to this project");
  }
  return pid2;
}
function duplicate(err) {
  return err.code === 11e3;
}
async function createParking(ctx, input) {
  const projectId = await checkParkingRefs(ctx, input.projectId, input.blockId);
  try {
    const slot = await ParkingSlot.create({
      ...input,
      companyId: ctx.companyId,
      projectId,
      history: [{ action: "created", by: ctx.userId }]
    });
    await audit(ctx, { action: "parking.create", entityType: "parking", entityId: slot._id, summary: slot.code });
    return slot.toJSON();
  } catch (err) {
    if (duplicate(err)) throw conflict(`Slot ${input.code} already exists in this project`);
    throw err;
  }
}
async function bulkCreateParking(ctx, input) {
  const projectId = await checkParkingRefs(ctx, input.projectId, input.blockId);
  const { prefix, startNumber, count, ...rest } = input;
  const docs = Array.from({ length: count }, (_, i) => ({
    ...rest,
    companyId: ctx.companyId,
    projectId,
    blockId: rest.blockId ? toObjectId(rest.blockId) : void 0,
    code: `${prefix}${startNumber + i}`,
    history: [{ action: "created", by: ctx.userId }]
  }));
  try {
    await ParkingSlot.insertMany(docs, { ordered: true });
  } catch (err) {
    if (duplicate(err)) throw conflict("Some slot codes already exist in this project; choose another starting number");
    throw err;
  }
  await audit(ctx, { action: "parking.bulk_create", entityType: "project", entityId: projectId, summary: `${count} parking slots` });
  return { created: count };
}
async function loadSlot(ctx, id) {
  const slot = await ParkingSlot.findOne({ companyId: ctx.companyId, _id: toObjectId(id) });
  if (!slot) throw notFound("Parking slot");
  assertProjectAccess(ctx, slot.projectId);
  return slot;
}
async function updateParking(ctx, id, input) {
  const slot = await loadSlot(ctx, id);
  if (input.blockId) await checkParkingRefs(ctx, slot.projectId, input.blockId);
  slot.set(input);
  try {
    await slot.save();
  } catch (err) {
    if (duplicate(err)) throw conflict(`Slot ${input.code} already exists in this project`);
    throw err;
  }
  await audit(ctx, { action: "parking.update", entityType: "parking", entityId: slot._id, changes: input });
  return slot.toJSON();
}
async function allotParking(ctx, id, input) {
  const slot = await loadSlot(ctx, id);
  const booking = await Booking.findOne({ companyId: ctx.companyId, _id: toObjectId(input.bookingId) }).select("projectId status bookingNumber customerId").lean();
  if (!booking || String(booking.projectId) !== String(slot.projectId)) throw badRequest("Choose a booking in the same project");
  if (!["reserved", "booked"].includes(booking.status)) throw businessRule(`Parking cannot be allotted to a ${booking.status} booking`);
  const res = await ParkingSlot.updateOne(
    { companyId: ctx.companyId, _id: slot._id, status: "available" },
    {
      $set: { status: "allotted", bookingId: booking._id, customerId: booking.customerId, allottedAt: /* @__PURE__ */ new Date() },
      $push: { history: { action: "allotted", bookingId: booking._id, note: input.remarks, by: ctx.userId } }
    }
  );
  if (res.modifiedCount !== 1) throw conflict(`Slot ${slot.code} is not available`);
  await audit(ctx, {
    action: "parking.allot",
    entityType: "parking",
    entityId: slot._id,
    summary: `${slot.code} \u2192 ${booking.bookingNumber}`
  });
  return { id: String(slot._id), status: "allotted" };
}
async function releaseParking(ctx, id, note) {
  const slot = await loadSlot(ctx, id);
  const res = await ParkingSlot.updateOne(
    { companyId: ctx.companyId, _id: slot._id, status: "allotted" },
    {
      $set: { status: "available", bookingId: null, customerId: null, allottedAt: null },
      $push: { history: { action: "released", bookingId: slot.bookingId, note, by: ctx.userId } }
    }
  );
  if (res.modifiedCount !== 1) throw businessRule("Only allotted slots can be released");
  await audit(ctx, { action: "parking.release", entityType: "parking", entityId: slot._id, summary: slot.code, changes: { note } });
  return { id: String(slot._id), status: "available" };
}
async function blockParking(ctx, id, blocked, note) {
  const slot = await loadSlot(ctx, id);
  const from = blocked ? "available" : "blocked";
  const to = blocked ? "blocked" : "available";
  const res = await ParkingSlot.updateOne(
    { companyId: ctx.companyId, _id: slot._id, status: from },
    { $set: { status: to }, $push: { history: { action: to === "blocked" ? "blocked" : "unblocked", note, by: ctx.userId } } }
  );
  if (res.modifiedCount !== 1) throw businessRule(`Only ${from} slots can be ${blocked ? "blocked" : "unblocked"}`);
  return { id: String(slot._id), status: to };
}
async function deleteParking(ctx, id) {
  const slot = await loadSlot(ctx, id);
  if (slot.status === "allotted") throw businessRule("Release the slot before deleting it");
  await ParkingSlot.deleteOne({ companyId: ctx.companyId, _id: slot._id });
  await audit(ctx, { action: "parking.delete", entityType: "parking", entityId: slot._id, summary: slot.code });
}
async function projectStructure(ctx, projectId) {
  const filter = scopedFilter(ctx, projectId);
  const projectFilter = { companyId: ctx.companyId, archivedAt: null };
  if (projectId) projectFilter._id = toObjectId(projectId);
  else if (ctx.projectScope !== null) projectFilter._id = { $in: ctx.projectScope };
  const [projects, phases, blocks, counts] = await Promise.all([
    Project.find(projectFilter).select("name code status").sort({ name: 1 }).lean(),
    ProjectPhase.find(filter).sort({ sequence: 1, code: 1 }).lean(),
    Block.find(filter).sort({ code: 1 }).lean(),
    Plot.aggregate([
      { $match: { ...filter, deletedAt: null } },
      { $group: { _id: { block: "$blockId", phase: "$phaseId", status: "$status" }, n: { $sum: 1 } } }
    ])
  ]);
  const tally = (key, id) => {
    const out = { total: 0 };
    for (const c of counts) {
      if (String(c._id[key]) !== String(id)) continue;
      out[c._id.status] = (out[c._id.status] ?? 0) + c.n;
      out.total += c.n;
    }
    return out;
  };
  return projects.map((p) => ({
    ...p,
    phases: phases.filter((ph) => String(ph.projectId) === String(p._id)).map((ph) => ({ ...ph, units: tally("phase", ph._id) })),
    blocks: blocks.filter((b) => String(b.projectId) === String(p._id)).map((b) => ({ ...b, units: tally("block", b._id) }))
  }));
}

// src/modules/masters/masters.routes.ts
var projectPop = { path: "projectId", select: "name code" };
var partiesRouter = crudRouter({
  model: Party,
  entity: "Party",
  auditType: "party",
  createSchema: partySchema,
  updateSchema: patchSchema(partySchema),
  permissions: { read: "masters.read", create: "masters.create", update: "masters.update", delete: "masters.delete" },
  searchFields: ["name", "phone", "pan", "email"],
  sortFields: ["name", "kind", "createdAt"],
  defaultSort: { name: 1 },
  populate: [
    { path: "landParcelIds", select: "khasraNumber village status" },
    { path: "projectIds", select: "name code" }
  ],
  filter: (q) => q.kind ? { kind: q.kind } : {},
  prepare: async (ctx, input) => {
    if (input.landParcelIds) input.landParcelIds = await assertRefs(ctx, LandParcel, input.landParcelIds, "Land parcel");
    if (input.projectIds) input.projectIds = await assertRefs(ctx, Project, input.projectIds, "Project", { project: true });
    return input;
  }
});
var financersRouter = crudRouter({
  model: Financer,
  entity: "Financer",
  auditType: "financer",
  createSchema: financerSchema,
  updateSchema: patchSchema(financerSchema),
  permissions: { read: "masters.read", create: "masters.create", update: "masters.update", delete: "masters.delete" },
  searchFields: ["name", "branch", "contactPerson", "phone"],
  sortFields: ["name", "type", "createdAt"],
  defaultSort: { name: 1 },
  populate: [{ path: "approvedProjectIds", select: "name code" }],
  filter: (q) => q.type ? { type: q.type } : {},
  prepare: async (ctx, input) => {
    if (input.approvedProjectIds)
      input.approvedProjectIds = await assertRefs(ctx, Project, input.approvedProjectIds, "Project");
    return input;
  },
  enrich: enrichFinancers,
  detail: financerDetail,
  beforeDelete: async (ctx, doc) => {
    if (await Booking.exists({ companyId: ctx.companyId, "loan.financerId": doc._id })) {
      throw businessRule("This lender is linked to bookings; mark it inactive instead");
    }
  }
});
var consultantsRouter = crudRouter({
  model: Consultant,
  entity: "Consultant",
  auditType: "consultant",
  createSchema: consultantSchema,
  updateSchema: patchSchema(consultantSchema),
  permissions: { read: "masters.read", create: "masters.create", update: "masters.update", delete: "masters.delete" },
  searchFields: ["name", "firm", "phone", "registrationNo"],
  sortFields: ["name", "type", "createdAt"],
  defaultSort: { name: 1 },
  filter: (q) => q.type ? { type: q.type } : {}
});
var chargesRouter = crudRouter({
  model: ChargeMaster,
  entity: "Charge",
  auditType: "charge",
  createSchema: chargeMasterSchema,
  updateSchema: patchSchema(chargeMasterBaseSchema),
  permissions: { read: "masters.read", create: "masters.create", update: "masters.update", delete: "masters.delete" },
  searchFields: ["name"],
  sortFields: ["name", "kind", "createdAt"],
  defaultSort: { kind: 1, name: 1 },
  projectField: { name: "projectId", allowNull: true },
  populate: [projectPop],
  filter: (q) => q.kind ? { kind: q.kind } : {},
  prepare: async (ctx, input) => {
    const i = input;
    if (i.projectId) await assertRefs(ctx, Project, [i.projectId], "Project", { project: true });
    else if ("projectId" in input && ctx.projectScope !== null) throw businessRule("Choose one of your projects");
    if (i.basis === "percent" && (i.value ?? 0) > 1e4) throw businessRule("Percentage cannot exceed 100%");
    return { ...input, projectId: i.projectId ? toObjectId(i.projectId) : null };
  },
  extend: (r) => {
    r.post(
      "/compute",
      authorize("masters.read"),
      validate({ body: z20.object({ projectId: z20.string(), plotIds: z20.array(z20.string()).max(20) }) }),
      async (req, res) => {
        const b = body(req);
        ok(res, await computeCharges(getCtx(req), b.projectId, b.plotIds));
      }
    );
  }
});
var rateIndexesRouter = crudRouter({
  model: RateIndex,
  entity: "Rate index",
  auditType: "rate_index",
  createSchema: rateIndexSchema,
  updateSchema: patchSchema(rateIndexSchema),
  permissions: { read: "inventory.read", create: "inventory.update", update: "inventory.update", delete: "inventory.update" },
  searchFields: ["name", "notes"],
  sortFields: ["effectiveFrom", "name", "ratePaisePerSqft", "createdAt"],
  defaultSort: { effectiveFrom: -1 },
  projectField: { name: "projectId" },
  populate: [projectPop, { path: "phaseId", select: "name code" }, { path: "blockId", select: "name code" }],
  prepare: async (ctx, input, existing) => {
    const projectId = input.projectId ?? (existing ? String(existing.projectId) : void 0);
    if (input.projectId) await assertRefs(ctx, Project, [projectId], "Project", { project: true });
    if (input.phaseId) {
      if (!await ProjectPhase.exists({
        companyId: ctx.companyId,
        projectId: toObjectId(projectId),
        _id: toObjectId(input.phaseId)
      }))
        throw businessRule("Phase does not belong to this project");
    }
    if (input.blockId) {
      if (!await Block.exists({ companyId: ctx.companyId, projectId: toObjectId(projectId), _id: toObjectId(input.blockId) }))
        throw businessRule("Tower / block does not belong to this project");
    }
    if (input.effectiveFrom) input.effectiveFrom = /* @__PURE__ */ new Date(`${input.effectiveFrom}T00:00:00.000Z`);
    return input;
  },
  extend: (r) => {
    r.post(
      "/:id/apply",
      authorize("inventory.update"),
      validate({ params: idParam, body: z20.object({ dryRun: z20.boolean().default(false) }) }),
      async (req, res) => ok(res, await applyRateIndex(getCtx(req), params(req).id, body(req).dryRun))
    );
  }
});
var parkingRouter = Router13();
parkingRouter.get("/", authorize("inventory.read"), validate({ query: parkingListQuerySchema }), async (req, res) => {
  const { items, meta: meta2 } = await listParking(getCtx(req), query(req));
  ok(res, items, meta2);
});
parkingRouter.get(
  "/summary",
  authorize("inventory.read"),
  validate({ query: parkingListQuerySchema }),
  async (req, res) => ok(res, (await listParking(getCtx(req), { ...query(req), page: 1, pageSize: 1 })).summary)
);
parkingRouter.post(
  "/",
  authorize("inventory.create"),
  validate({ body: parkingSlotSchema }),
  async (req, res) => created(res, await createParking(getCtx(req), body(req)))
);
parkingRouter.post(
  "/bulk",
  authorize("inventory.create"),
  validate({ body: parkingBulkSchema }),
  async (req, res) => created(res, await bulkCreateParking(getCtx(req), body(req)))
);
parkingRouter.patch(
  "/:id",
  authorize("inventory.update"),
  validate({ params: idParam, body: patchSchema(parkingSlotSchema.omit({ projectId: true })) }),
  async (req, res) => ok(res, await updateParking(getCtx(req), params(req).id, body(req)))
);
parkingRouter.post(
  "/:id/allot",
  authorize("inventory.status"),
  validate({ params: idParam, body: parkingAllotSchema }),
  async (req, res) => ok(res, await allotParking(getCtx(req), params(req).id, body(req)))
);
parkingRouter.post(
  "/:id/release",
  authorize("inventory.status"),
  validate({ params: idParam, body: z20.object({ note: requiredText("Reason", 300) }) }),
  async (req, res) => ok(res, await releaseParking(getCtx(req), params(req).id, body(req).note))
);
parkingRouter.post(
  "/:id/block",
  authorize("inventory.status"),
  validate({ params: idParam, body: z20.object({ blocked: z20.boolean(), note: requiredText("Reason", 300) }) }),
  async (req, res) => {
    const b = body(req);
    ok(res, await blockParking(getCtx(req), params(req).id, b.blocked, b.note));
  }
);
parkingRouter.delete("/:id", authorize("inventory.delete"), validate({ params: idParam }), async (req, res) => {
  await deleteParking(getCtx(req), params(req).id);
  ok(res, { deleted: true });
});
var structureRouter = Router13();
structureRouter.get(
  "/",
  authorize("projects.read"),
  validate({ query: z20.object({ projectId: objectId.optional() }) }),
  async (req, res) => ok(res, await projectStructure(getCtx(req), query(req).projectId))
);

// src/modules/finance/finance.routes.ts
import { Router as Router14 } from "express";
import { z as z21 } from "zod";

// src/modules/finance/finance.service.ts
import { Types as Types13 } from "mongoose";
var day = (d) => parseISODate(d ?? todayInIndia());
var titleCase = (s) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
function cashBankFilter(ctx) {
  return {
    companyId: ctx.companyId,
    type: "asset",
    $or: [{ systemKey: { $in: ["cash", "bank"] } }, { isBank: true }, { cashBankKind: { $in: ["bank", "cash"] } }]
  };
}
async function listCashBankAccounts(ctx) {
  const accounts = await Account.find(cashBankFilter(ctx)).sort({ code: 1 }).lean();
  const ids = accounts.map((a) => a._id);
  const balances = await JournalEntry.aggregate([
    { $match: { companyId: ctx.companyId, "lines.accountId": { $in: ids } } },
    { $unwind: "$lines" },
    { $match: { "lines.accountId": { $in: ids } } },
    {
      $group: {
        _id: "$lines.accountId",
        debit: { $sum: "$lines.debitPaise" },
        credit: { $sum: "$lines.creditPaise" },
        last: { $max: "$date" }
      }
    }
  ]);
  const byId = new Map(balances.map((b) => [String(b._id), b]));
  return accounts.map((a) => {
    const b = byId.get(String(a._id));
    return {
      ...a,
      kind: a.cashBankKind ?? (a.systemKey === "cash" ? "cash" : "bank"),
      balancePaise: (b?.debit ?? 0) - (b?.credit ?? 0),
      inflowPaise: b?.debit ?? 0,
      outflowPaise: b?.credit ?? 0,
      lastTransactionOn: b?.last
    };
  });
}
async function nextCashBankCode(ctx, kind) {
  const [lo, hi] = kind === "cash" ? [1001, 1009] : [1011, 1099];
  const taken = new Set((await Account.find({ companyId: ctx.companyId }).select("code").lean()).map((a) => a.code));
  for (let c = lo; c <= hi; c++) if (!taken.has(String(c))) return String(c);
  for (let c = 1; c < 1e3; c++) if (!taken.has(`${lo - 1}-${c}`)) return `${lo - 1}-${c}`;
  throw businessRule("No free account codes left in the cash/bank range");
}
async function createCashBankAccount(ctx, input) {
  return withTransaction(async (session) => {
    const code2 = await nextCashBankCode(ctx, input.kind);
    const [account] = await Account.create(
      [
        {
          companyId: ctx.companyId,
          code: code2,
          name: input.name,
          type: "asset",
          isBank: input.kind === "bank",
          cashBankKind: input.kind,
          bankDetails: input.kind === "bank" ? {
            bankName: input.bankName,
            accountNumber: input.accountNumber,
            ifsc: input.ifsc,
            branch: input.branch,
            accountType: input.accountType,
            isReraAccount: input.isReraAccount
          } : void 0
        }
      ],
      { session }
    );
    if (input.openingBalancePaise > 0) {
      await postJournal(
        ctx,
        {
          date: input.openingDate ?? todayInIndia(),
          voucherType: "journal",
          narration: `Opening balance: ${input.name}`,
          lines: [
            { accountId: account._id, debitPaise: input.openingBalancePaise },
            { systemKey: "capital", creditPaise: input.openingBalancePaise }
          ],
          source: { type: "opening_balance", id: account._id }
        },
        session
      );
    }
    await audit(
      ctx,
      { action: "accounting.cash_bank_create", entityType: "account", entityId: account._id, summary: `${code2} ${input.name}` },
      session
    );
    return account.toJSON();
  });
}
async function updateCashBankAccount(ctx, id, input) {
  const account = await Account.findOne({ ...cashBankFilter(ctx), _id: toObjectId(id) });
  if (!account) throw notFound("Account");
  if (input.isActive === false && account.systemKey) throw businessRule("The default cash and bank accounts cannot be deactivated");
  if (input.name) account.name = input.name;
  if (input.isActive !== void 0) account.isActive = input.isActive;
  const details = ["bankName", "accountNumber", "ifsc", "branch", "accountType", "isReraAccount"];
  for (const k of details) if (input[k] !== void 0) account.set(`bankDetails.${k}`, input[k]);
  await account.save();
  await audit(ctx, { action: "accounting.cash_bank_update", entityType: "account", entityId: account._id, changes: input });
  return account.toJSON();
}
var PENDING_PDC = ["received", "deposited", "clearing"];
async function activeBooking(ctx, bookingId) {
  const booking = await Booking.findOne({ companyId: ctx.companyId, _id: toObjectId(bookingId) }).lean();
  if (!booking) throw notFound("Booking");
  assertProjectAccess(ctx, booking.projectId);
  if (!["reserved", "booked"].includes(booking.status)) throw businessRule(`This booking is ${booking.status}`);
  return booking;
}
async function listPdcs(ctx, q) {
  const base2 = scopedFilter(ctx, q.projectId);
  const filter = { ...base2 };
  if (q.status) filter.status = q.status;
  if (q.bookingId) filter.bookingId = toObjectId(q.bookingId);
  if (q.due) {
    filter.status = "received";
    filter.chequeDate = { $lte: day() };
  }
  if (q.from || q.to) filter.chequeDate = { ...q.from ? { $gte: day(q.from) } : {}, ...q.to ? { $lte: day(q.to) } : {} };
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), "i");
    filter.$or = [{ chequeNumber: rx }, { bankName: rx }];
  }
  const sort = parseSort(q.sort, ["chequeDate", "amountPaise", "status", "createdAt"], { chequeDate: 1 });
  const [items, total, summary] = await Promise.all([
    Pdc.find(filter).sort(sort).skip((q.page - 1) * q.pageSize).limit(q.pageSize).select("-history").populate({ path: "customerId", select: "name phone", match: { companyId: ctx.companyId } }).populate({ path: "bookingId", select: "bookingNumber", match: { companyId: ctx.companyId } }).populate({ path: "projectId", select: "name code", match: { companyId: ctx.companyId } }).populate({ path: "paymentId", select: "number", match: { companyId: ctx.companyId } }).lean(),
    Pdc.countDocuments(filter),
    Pdc.aggregate([
      { $match: base2 },
      { $group: { _id: "$status", n: { $sum: 1 }, amount: { $sum: "$amountPaise" } } }
    ])
  ]);
  const dueForDeposit = await Pdc.aggregate([
    { $match: { ...base2, status: "received", chequeDate: { $lte: day() } } },
    { $group: { _id: null, n: { $sum: 1 }, amount: { $sum: "$amountPaise" } } }
  ]);
  return {
    items,
    meta: pageMeta(q.page, q.pageSize, total),
    summary: {
      byStatus: Object.fromEntries(summary.map((s) => [s._id, { count: s.n, amountPaise: s.amount }])),
      dueForDeposit: { count: dueForDeposit[0]?.n ?? 0, amountPaise: dueForDeposit[0]?.amount ?? 0 }
    }
  };
}
async function createPdc(ctx, input) {
  const booking = await activeBooking(ctx, input.bookingId);
  const pending = await Pdc.aggregate([
    { $match: { companyId: ctx.companyId, bookingId: booking._id, status: { $in: PENDING_PDC } } },
    { $group: { _id: null, amount: { $sum: "$amountPaise" } } }
  ]);
  const outstanding2 = booking.netAmountPaise - booking.allocatedPaise;
  const pendingAmount = pending[0]?.amount ?? 0;
  if (pendingAmount + input.amountPaise > outstanding2) {
    throw businessRule(
      `Cheques on hand (${formatINR(pendingAmount)}) plus this cheque would exceed the ${formatINR(outstanding2)} outstanding on ${booking.bookingNumber}`
    );
  }
  try {
    const pdc = await Pdc.create({
      ...input,
      companyId: ctx.companyId,
      projectId: booking.projectId,
      bookingId: booking._id,
      customerId: booking.customerId,
      chequeDate: day(input.chequeDate),
      status: "received",
      history: [{ status: "received", by: ctx.userId }],
      createdBy: ctx.userId
    });
    await audit(ctx, {
      action: "pdc.create",
      entityType: "pdc",
      entityId: pdc._id,
      summary: `Chq ${input.chequeNumber} ${formatINR(input.amountPaise)} for ${booking.bookingNumber}`
    });
    return pdc.toJSON();
  } catch (err) {
    if (err.code === 11e3) throw conflict("This cheque is already recorded for the booking");
    throw err;
  }
}
async function loadPdc(ctx, id) {
  const pdc = await Pdc.findOne({ companyId: ctx.companyId, _id: toObjectId(id) }).lean();
  if (!pdc) throw notFound("Cheque");
  assertProjectAccess(ctx, pdc.projectId);
  return pdc;
}
async function movePdc(ctx, id, from, to, set, note) {
  const res = await Pdc.updateOne(
    { companyId: ctx.companyId, _id: id, status: { $in: from } },
    { $set: { status: to, ...set }, $push: { history: { status: to, note, by: ctx.userId } } }
  );
  if (res.modifiedCount !== 1) throw businessRule(`Only ${from.join(" or ")} cheques can be marked ${to}`);
}
async function depositPdc(ctx, id, input) {
  const pdc = await loadPdc(ctx, id);
  const accountId = await withTransaction((session) => resolveCashAccountFor(ctx.companyId, input.depositAccountId, "cheque", session));
  await movePdc(ctx, pdc._id, ["received"], "deposited", { depositedOn: day(input.depositedOn), depositAccountId: accountId });
  await audit(ctx, { action: "pdc.deposit", entityType: "pdc", entityId: pdc._id });
  return { id: String(pdc._id), status: "deposited" };
}
async function clearPdc(ctx, id, input) {
  const pdc = await loadPdc(ctx, id);
  const previous = pdc.status;
  await movePdc(ctx, pdc._id, ["received", "deposited"], "clearing", {});
  try {
    const payment = await recordPayment(ctx, {
      bookingId: String(pdc.bookingId),
      amountPaise: pdc.amountPaise,
      mode: "cheque",
      receivedOn: input.clearedOn,
      reference: `Chq ${pdc.chequeNumber}`,
      bankName: pdc.bankName,
      depositAccountId: pdc.depositAccountId ? String(pdc.depositAccountId) : void 0,
      remarks: "Post-dated cheque cleared"
    });
    const paymentId = payment.id ?? String(payment._id);
    await Pdc.updateOne(
      { companyId: ctx.companyId, _id: pdc._id, status: "clearing" },
      {
        $set: { status: "cleared", clearedOn: day(input.clearedOn), paymentId: toObjectId(paymentId) },
        $push: { history: { status: "cleared", note: payment.number, by: ctx.userId } }
      }
    );
    await audit(ctx, { action: "pdc.clear", entityType: "pdc", entityId: pdc._id, summary: `Receipt ${payment.number}` });
    return { id: String(pdc._id), status: "cleared", paymentId, receiptNumber: payment.number };
  } catch (err) {
    await Pdc.updateOne({ companyId: ctx.companyId, _id: pdc._id, status: "clearing" }, { $set: { status: previous } });
    throw err;
  }
}
async function bouncePdc(ctx, id, input) {
  const pdc = await loadPdc(ctx, id);
  await movePdc(
    ctx,
    pdc._id,
    ["received", "deposited"],
    "bounced",
    { bouncedOn: day(input.bouncedOn), bounceReason: input.reason },
    input.reason
  );
  await audit(ctx, { action: "pdc.bounce", entityType: "pdc", entityId: pdc._id, changes: input });
  return { id: String(pdc._id), status: "bounced" };
}
async function returnPdc(ctx, id, reason) {
  const pdc = await loadPdc(ctx, id);
  await movePdc(ctx, pdc._id, ["received", "bounced"], "returned", {}, reason);
  await audit(ctx, { action: "pdc.return", entityType: "pdc", entityId: pdc._id, changes: { reason } });
  return { id: String(pdc._id), status: "returned" };
}
async function listVendorPayments(ctx, q) {
  const filter = { companyId: ctx.companyId };
  if (q.projectId) {
    assertProjectAccess(ctx, q.projectId);
    filter.projectId = toObjectId(q.projectId);
  } else if (ctx.projectScope !== null) filter.projectId = { $in: ctx.projectScope };
  if (q.vendorId) filter.vendorId = toObjectId(q.vendorId);
  if (q.from || q.to) filter.date = { ...q.from ? { $gte: day(q.from) } : {}, ...q.to ? { $lte: day(q.to) } : {} };
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), "i");
    filter.$or = [{ number: rx }, { reference: rx }];
  }
  const sort = parseSort(q.sort, ["date", "amountPaise", "number"], { date: -1, createdAt: -1 });
  const [items, total, totals] = await Promise.all([
    VendorPayment.find(filter).sort(sort).skip((q.page - 1) * q.pageSize).limit(q.pageSize).populate({ path: "vendorId", select: "name category", match: { companyId: ctx.companyId } }).populate({ path: "projectId", select: "name code", match: { companyId: ctx.companyId } }).populate({ path: "accountId", select: "code name", match: { companyId: ctx.companyId } }).lean(),
    VendorPayment.countDocuments(filter),
    VendorPayment.aggregate([{ $match: filter }, { $group: { _id: null, amount: { $sum: "$amountPaise" } } }])
  ]);
  return { items, meta: pageMeta(q.page, q.pageSize, total), totalPaise: totals[0]?.amount ?? 0 };
}
var DEFAULT_ADJ_ACCOUNT = {
  discount: "discount_allowed",
  waiver: "discount_allowed",
  rounding: "discount_allowed",
  interest: "interest_income",
  late_fee: "interest_income",
  other: "other_income"
};
async function adjustmentAccount(ctx, input, session) {
  if (!input.accountId) {
    const key = input.type === "debit" && ["discount", "waiver", "rounding"].includes(input.reason) ? "other_income" : DEFAULT_ADJ_ACCOUNT[input.reason];
    return systemAccountId(ctx.companyId, key, session);
  }
  const acc = await Account.findOne({ companyId: ctx.companyId, _id: toObjectId(input.accountId), isActive: true }).session(session).lean();
  if (!acc || !["income", "expense"].includes(acc.type)) throw badRequest("Choose an active income or expense account");
  if (acc.systemKey && CONTROL_ACCOUNT_KEYS.includes(acc.systemKey))
    throw badRequest("Choose an income or expense account");
  return acc._id;
}
function instStatus(amount, paid) {
  if (paid >= amount) return "paid";
  return paid > 0 ? "partial" : "pending";
}
async function createAdjustment(ctx, input) {
  return withTransaction(async (session) => {
    const booking = await Booking.findOne({ companyId: ctx.companyId, _id: toObjectId(input.bookingId) }).session(session).lean();
    if (!booking) throw notFound("Booking");
    assertProjectAccess(ctx, booking.projectId);
    if (!["reserved", "booked"].includes(booking.status)) throw businessRule(`Adjustments cannot be made on a ${booking.status} booking`);
    const accountId = await adjustmentAccount(ctx, input, session);
    const number = await nextDocumentNumber(ctx.companyId, "ADJ", input.date, session);
    const adjId = new Types13.ObjectId();
    const effects = [];
    if (input.type === "credit") {
      const open = await Installment.find({ companyId: ctx.companyId, bookingId: booking._id, status: { $in: ["pending", "partial"] } }).sort({ dueDate: -1, sequence: -1 }).session(session).lean();
      const outstanding2 = open.reduce((s, i) => s + (i.amountPaise - i.paidPaise), 0);
      if (input.amountPaise > outstanding2) throw businessRule(`A credit note cannot exceed the ${formatINR(outstanding2)} still due`);
      let remaining = input.amountPaise;
      for (const inst of open) {
        if (!remaining) break;
        const take = Math.min(inst.amountPaise - inst.paidPaise, remaining);
        if (take <= 0) continue;
        const amount = inst.amountPaise - take;
        const upd2 = await Installment.updateOne(
          { companyId: ctx.companyId, _id: inst._id, amountPaise: inst.amountPaise, paidPaise: inst.paidPaise },
          { $set: { amountPaise: amount, status: instStatus(amount, inst.paidPaise) } },
          { session }
        );
        if (upd2.modifiedCount !== 1) throw businessRule("Installments changed concurrently, please retry");
        effects.push({ installmentId: inst._id, deltaPaise: -take });
        remaining -= take;
      }
    } else {
      const last = await Installment.findOne({ companyId: ctx.companyId, bookingId: booking._id }).sort({ sequence: -1 }).session(session).lean();
      const [inst] = await Installment.create(
        [
          {
            companyId: ctx.companyId,
            projectId: booking.projectId,
            bookingId: booking._id,
            customerId: booking.customerId,
            sequence: (last?.sequence ?? 0) + 1,
            name: `${titleCase(input.reason)} (${number})`,
            dueDate: day(input.dueDate ?? input.date),
            amountPaise: input.amountPaise
          }
        ],
        { session }
      );
      effects.push({ installmentId: inst._id, deltaPaise: input.amountPaise, created: true });
    }
    const receivable = { systemKey: "customer_receivable", customerId: booking.customerId, bookingId: booking._id };
    const je = await postJournal(
      ctx,
      {
        date: input.date,
        voucherType: "journal",
        narration: `${input.type === "credit" ? "Credit" : "Debit"} note ${number} on ${booking.bookingNumber}: ${input.narration}`,
        reference: number,
        projectId: booking.projectId,
        lines: input.type === "credit" ? [
          { accountId, debitPaise: input.amountPaise },
          { ...receivable, creditPaise: input.amountPaise }
        ] : [
          { ...receivable, debitPaise: input.amountPaise },
          { accountId, creditPaise: input.amountPaise }
        ],
        source: { type: "ledger_adjustment", id: adjId },
        allowControlAccounts: true
      },
      session
    );
    const delta = input.type === "credit" ? -input.amountPaise : input.amountPaise;
    const upd = await Booking.updateOne(
      { companyId: ctx.companyId, _id: booking._id, status: booking.status },
      { $inc: { netAmountPaise: delta, adjustmentsPaise: delta } },
      { session }
    );
    if (upd.modifiedCount !== 1) throw businessRule("Booking changed concurrently, please retry");
    const [adj] = await LedgerAdjustment.create(
      [
        {
          _id: adjId,
          companyId: ctx.companyId,
          number,
          projectId: booking.projectId,
          bookingId: booking._id,
          customerId: booking.customerId,
          type: input.type,
          reason: input.reason,
          amountPaise: input.amountPaise,
          date: day(input.date),
          accountId,
          narration: input.narration,
          effects,
          journalEntryId: je._id,
          createdBy: ctx.userId
        }
      ],
      { session }
    );
    await audit(
      ctx,
      {
        action: "accounting.adjustment",
        entityType: "booking",
        entityId: booking._id,
        summary: `${number} ${input.type} ${formatINR(input.amountPaise)}`
      },
      session
    );
    return adj.toJSON();
  });
}
async function reverseAdjustment(ctx, id, reason) {
  return withTransaction(async (session) => {
    const adj = await LedgerAdjustment.findOne({ companyId: ctx.companyId, _id: toObjectId(id) }).session(session).lean();
    if (!adj) throw notFound("Adjustment");
    assertProjectAccess(ctx, adj.projectId);
    if (adj.status !== "posted") throw businessRule("This adjustment has already been reversed");
    const booking = await Booking.findOne({ companyId: ctx.companyId, _id: adj.bookingId }).session(session).lean();
    if (!booking || !["reserved", "booked"].includes(booking.status)) throw businessRule("The booking is no longer active");
    for (const e of adj.effects) {
      const inst = await Installment.findOne({ companyId: ctx.companyId, _id: e.installmentId }).session(session).lean();
      if (!inst) throw businessRule("An installment changed by this adjustment no longer exists");
      if (e.created) {
        if (inst.paidPaise > 0)
          throw businessRule("The charge has already been (partly) paid; reverse the receipt first or post a credit note");
        await Installment.updateOne(
          { companyId: ctx.companyId, _id: inst._id, paidPaise: 0 },
          { $set: { status: "cancelled" } },
          { session }
        );
      } else {
        const amount = inst.amountPaise - (e.deltaPaise ?? 0);
        await Installment.updateOne(
          { companyId: ctx.companyId, _id: inst._id, amountPaise: inst.amountPaise },
          { $set: { amountPaise: amount, status: inst.status === "cancelled" ? "cancelled" : instStatus(amount, inst.paidPaise) } },
          { session }
        );
      }
    }
    const rev = await reverseJournal(ctx, adj.journalEntryId, reason, session, todayInIndia());
    const delta = adj.type === "credit" ? adj.amountPaise : -adj.amountPaise;
    await Booking.updateOne(
      { companyId: ctx.companyId, _id: booking._id },
      { $inc: { netAmountPaise: delta, adjustmentsPaise: delta } },
      { session }
    );
    await LedgerAdjustment.updateOne(
      { companyId: ctx.companyId, _id: adj._id, status: "posted" },
      { $set: { status: "reversed", reversal: { at: /* @__PURE__ */ new Date(), by: ctx.userId, reason, journalEntryId: rev._id } } },
      { session }
    );
    await audit(
      ctx,
      { action: "accounting.adjustment_reverse", entityType: "booking", entityId: booking._id, summary: adj.number, changes: { reason } },
      session
    );
    return { id: String(adj._id), status: "reversed" };
  });
}
async function listAdjustments(ctx, q) {
  const filter = scopedFilter(ctx, q.projectId);
  if (q.bookingId) filter.bookingId = toObjectId(q.bookingId);
  if (q.type) filter.type = q.type;
  if (q.q) filter.number = new RegExp(escapeRegex(q.q), "i");
  const sort = parseSort(q.sort, ["date", "amountPaise", "number"], { date: -1, createdAt: -1 });
  const [items, total] = await Promise.all([
    LedgerAdjustment.find(filter).sort(sort).skip((q.page - 1) * q.pageSize).limit(q.pageSize).populate({ path: "bookingId", select: "bookingNumber", match: { companyId: ctx.companyId } }).populate({ path: "customerId", select: "name", match: { companyId: ctx.companyId } }).populate({ path: "accountId", select: "code name", match: { companyId: ctx.companyId } }).populate({ path: "createdBy", select: "name" }).lean(),
    LedgerAdjustment.countDocuments(filter)
  ]);
  return { items, meta: pageMeta(q.page, q.pageSize, total) };
}
function gstSplit(taxablePaise, rateBp, interState) {
  if (interState) {
    const igst = applyBasisPoints(taxablePaise, rateBp);
    return { cgst: 0, sgst: 0, igst, total: taxablePaise + igst };
  }
  const half = applyBasisPoints(taxablePaise, rateBp / 2);
  return { cgst: half, sgst: half, igst: 0, total: taxablePaise + 2 * half };
}
async function createGstVoucher(ctx, input) {
  return withTransaction(async (session) => {
    const acc = await Account.findOne({ companyId: ctx.companyId, _id: toObjectId(input.accountId), isActive: true }).session(session).lean();
    const allowed = input.direction === "output" ? ["income"] : ["expense", "asset"];
    if (!acc || !allowed.includes(acc.type) || acc.systemKey && CONTROL_ACCOUNT_KEYS.includes(acc.systemKey) || acc.systemKey?.startsWith("gst_")) {
      throw badRequest(input.direction === "output" ? "Choose an income account" : "Choose an expense or asset account");
    }
    if (input.projectId) assertProjectAccess(ctx, input.projectId);
    let vendorId;
    let settlementAccountId;
    if (input.vendorId) {
      const vendor = await Vendor.findOne({ companyId: ctx.companyId, _id: toObjectId(input.vendorId) }).session(session).lean();
      if (!vendor) throw badRequest("Vendor not found");
      vendorId = vendor._id;
    } else {
      settlementAccountId = await resolveCashAccountFor(ctx.companyId, input.settlementAccountId, input.mode ?? "neft", session);
    }
    const tax = gstSplit(input.taxableValuePaise, input.rateBp, input.interState);
    const number = await nextDocumentNumber(ctx.companyId, "GSV", input.date, session);
    const voucherId = new Types13.ObjectId();
    const side = input.direction === "output" ? "creditPaise" : "debitPaise";
    const prefix = input.direction === "output" ? "gst_output" : "gst_input";
    const taxLines = [
      { systemKey: `${prefix}_cgst`, [side]: tax.cgst },
      { systemKey: `${prefix}_sgst`, [side]: tax.sgst },
      { systemKey: `${prefix}_igst`, [side]: tax.igst }
    ];
    const counter = vendorId ? { systemKey: "vendor_payable", vendorId, creditPaise: tax.total } : input.direction === "output" ? { accountId: settlementAccountId, debitPaise: tax.total } : { accountId: settlementAccountId, creditPaise: tax.total };
    const je = await postJournal(
      ctx,
      {
        date: input.date,
        voucherType: vendorId ? "journal" : input.direction === "output" ? "sales" : "payment",
        narration: `GST ${input.direction === "output" ? "sale" : "purchase"} ${number}: ${input.partyName} inv ${input.invoiceNumber} \u2013 ${input.description}`,
        reference: input.invoiceNumber,
        projectId: input.projectId,
        lines: [{ accountId: acc._id, [side]: input.taxableValuePaise }, ...taxLines, counter],
        source: { type: "gst_voucher", id: voucherId },
        allowControlAccounts: !!vendorId
      },
      session
    );
    const [voucher] = await GstVoucher.create(
      [
        {
          _id: voucherId,
          companyId: ctx.companyId,
          number,
          ...input,
          date: day(input.date),
          cgstPaise: tax.cgst,
          sgstPaise: tax.sgst,
          igstPaise: tax.igst,
          totalPaise: tax.total,
          accountId: acc._id,
          settlementAccountId,
          vendorId,
          projectId: input.projectId ? toObjectId(input.projectId) : void 0,
          journalEntryId: je._id,
          createdBy: ctx.userId
        }
      ],
      { session }
    );
    await audit(
      ctx,
      { action: "accounting.gst_voucher", entityType: "gst_voucher", entityId: voucherId, summary: `${number} ${formatINR(tax.total)}` },
      session
    );
    return voucher.toJSON();
  });
}
async function reverseGstVoucher(ctx, id, reason) {
  return withTransaction(async (session) => {
    const v = await GstVoucher.findOne({ companyId: ctx.companyId, _id: toObjectId(id) }).session(session).lean();
    if (!v) throw notFound("GST voucher");
    if (v.status !== "posted") throw businessRule("This voucher has already been reversed");
    if (v.vendorId) {
      const balance = await partyBalance(ctx.companyId, { vendorId: v.vendorId }, "vendor_payable", session);
      if (balance < v.totalPaise) throw businessRule("This purchase has already been paid; record a debit note instead");
    }
    const rev = await reverseJournal(ctx, v.journalEntryId, reason, session, todayInIndia());
    await GstVoucher.updateOne(
      { companyId: ctx.companyId, _id: v._id, status: "posted" },
      { $set: { status: "reversed", reversal: { at: /* @__PURE__ */ new Date(), by: ctx.userId, reason, journalEntryId: rev._id } } },
      { session }
    );
    await audit(
      ctx,
      { action: "accounting.gst_voucher_reverse", entityType: "gst_voucher", entityId: v._id, changes: { reason } },
      session
    );
    return { id: String(v._id), status: "reversed" };
  });
}
async function listGstVouchers(ctx, q) {
  const filter = { companyId: ctx.companyId };
  if (q.direction) filter.direction = q.direction;
  if (q.from || q.to) filter.date = { ...q.from ? { $gte: day(q.from) } : {}, ...q.to ? { $lte: day(q.to) } : {} };
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), "i");
    filter.$or = [{ number: rx }, { invoiceNumber: rx }, { partyName: rx }, { partyGstin: rx }];
  }
  const sort = parseSort(q.sort, ["date", "totalPaise", "number"], { date: -1, createdAt: -1 });
  const [items, total] = await Promise.all([
    GstVoucher.find(filter).sort(sort).skip((q.page - 1) * q.pageSize).limit(q.pageSize).populate({ path: "accountId", select: "code name", match: { companyId: ctx.companyId } }).populate({ path: "vendorId", select: "name", match: { companyId: ctx.companyId } }).lean(),
    GstVoucher.countDocuments(filter)
  ]);
  return { items, meta: pageMeta(q.page, q.pageSize, total) };
}
async function gstSummary(ctx, from, to) {
  const rows = await GstVoucher.aggregate([
    { $match: { companyId: ctx.companyId, status: "posted", date: { $gte: day(from), $lte: day(to) } } },
    {
      $group: {
        _id: { direction: "$direction", month: { $dateToString: { format: "%Y-%m", date: "$date" } } },
        taxable: { $sum: "$taxableValuePaise" },
        cgst: { $sum: "$cgstPaise" },
        sgst: { $sum: "$sgstPaise" },
        igst: { $sum: "$igstPaise" },
        count: { $sum: 1 }
      }
    },
    { $sort: { "_id.month": 1 } }
  ]);
  const empty = () => ({ taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, count: 0 });
  const totals = { output: empty(), input: empty() };
  const months = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const t = totals[r._id.direction];
    t.taxablePaise += r.taxable;
    t.cgstPaise += r.cgst;
    t.sgstPaise += r.sgst;
    t.igstPaise += r.igst;
    t.count += r.count;
    const m = months.get(r._id.month) ?? { month: r._id.month, outputTaxPaise: 0, inputTaxPaise: 0 };
    if (r._id.direction === "output") m.outputTaxPaise += r.cgst + r.sgst + r.igst;
    else m.inputTaxPaise += r.cgst + r.sgst + r.igst;
    months.set(r._id.month, m);
  }
  const net = {
    cgstPaise: totals.output.cgstPaise - totals.input.cgstPaise,
    sgstPaise: totals.output.sgstPaise - totals.input.sgstPaise,
    igstPaise: totals.output.igstPaise - totals.input.igstPaise
  };
  return { from, to, totals, net, netPayablePaise: net.cgstPaise + net.sgstPaise + net.igstPaise, months: [...months.values()] };
}

// src/modules/finance/finance.routes.ts
var reasonBody = z21.object({ reason: requiredText("Reason", 500) });
var cashBankRouter = Router14();
cashBankRouter.get("/", authorize("accounting.read"), async (req, res) => ok(res, await listCashBankAccounts(getCtx(req))));
cashBankRouter.post(
  "/",
  authorize("accounting.manageAccounts"),
  validate({ body: cashBankAccountSchema }),
  async (req, res) => created(res, await createCashBankAccount(getCtx(req), body(req)))
);
cashBankRouter.patch(
  "/:id",
  authorize("accounting.manageAccounts"),
  validate({ params: idParam, body: cashBankAccountUpdateSchema }),
  async (req, res) => ok(res, await updateCashBankAccount(getCtx(req), params(req).id, body(req)))
);
var pdcRouter = Router14();
pdcRouter.get("/", authorize("pdc.read"), validate({ query: pdcListQuerySchema }), async (req, res) => {
  const { items, meta: meta2 } = await listPdcs(getCtx(req), query(req));
  ok(res, items, meta2);
});
pdcRouter.get(
  "/summary",
  authorize("pdc.read"),
  validate({ query: pdcListQuerySchema }),
  async (req, res) => ok(res, (await listPdcs(getCtx(req), { ...query(req), page: 1, pageSize: 1 })).summary)
);
pdcRouter.post(
  "/",
  authorize("pdc.create"),
  validate({ body: pdcSchema }),
  async (req, res) => created(res, await createPdc(getCtx(req), body(req)))
);
pdcRouter.post(
  "/:id/deposit",
  authorize("pdc.update"),
  validate({ params: idParam, body: pdcDepositSchema }),
  async (req, res) => ok(res, await depositPdc(getCtx(req), params(req).id, body(req)))
);
pdcRouter.post(
  "/:id/clear",
  authorize("pdc.update", "payments.create"),
  validate({ params: idParam, body: pdcClearSchema }),
  idempotent,
  async (req, res) => ok(res, await clearPdc(getCtx(req), params(req).id, body(req)))
);
pdcRouter.post(
  "/:id/bounce",
  authorize("pdc.update"),
  validate({ params: idParam, body: pdcBounceSchema }),
  async (req, res) => ok(res, await bouncePdc(getCtx(req), params(req).id, body(req)))
);
pdcRouter.post(
  "/:id/return",
  authorize("pdc.update"),
  validate({ params: idParam, body: pdcReturnSchema }),
  async (req, res) => ok(res, await returnPdc(getCtx(req), params(req).id, body(req).reason))
);
var vendorPaymentsRouter = Router14();
vendorPaymentsRouter.get("/", authorize("vendors.read"), validate({ query: vendorPaymentListQuerySchema }), async (req, res) => {
  const { items, meta: meta2, totalPaise } = await listVendorPayments(getCtx(req), query(req));
  res.setHeader("x-total-amount", String(totalPaise));
  ok(res, items, meta2);
});
var adjustmentsRouter = Router14();
adjustmentsRouter.get(
  "/",
  authorize("accounting.read"),
  validate({
    query: listQuerySchema.extend({
      projectId: objectId.optional(),
      bookingId: objectId.optional(),
      type: z21.enum(ADJUSTMENT_TYPES).optional()
    })
  }),
  async (req, res) => {
    const { items, meta: meta2 } = await listAdjustments(getCtx(req), query(req));
    ok(res, items, meta2);
  }
);
adjustmentsRouter.post(
  "/",
  authorize("accounting.adjust"),
  validate({ body: ledgerAdjustmentSchema }),
  idempotent,
  async (req, res) => created(res, await createAdjustment(getCtx(req), body(req)))
);
adjustmentsRouter.post(
  "/:id/reverse",
  authorize("accounting.adjust"),
  validate({ params: idParam, body: reasonBody }),
  async (req, res) => ok(res, await reverseAdjustment(getCtx(req), params(req).id, body(req).reason))
);
var gstRouter = Router14();
gstRouter.get("/", authorize("accounting.read"), validate({ query: gstListQuerySchema }), async (req, res) => {
  const { items, meta: meta2 } = await listGstVouchers(getCtx(req), query(req));
  ok(res, items, meta2);
});
gstRouter.get(
  "/summary",
  authorize("accounting.read"),
  validate({ query: z21.object({ from: isoDate.optional(), to: isoDate.optional() }) }),
  async (req, res) => {
    const q = query(req);
    const today = todayInIndia();
    const fyStart = `${financialYear(today).slice(0, 4)}-04-01`;
    ok(res, await gstSummary(getCtx(req), q.from ?? fyStart, q.to ?? today));
  }
);
gstRouter.post(
  "/",
  authorize("accounting.create"),
  validate({ body: gstVoucherSchema }),
  idempotent,
  async (req, res) => created(res, await createGstVoucher(getCtx(req), body(req)))
);
gstRouter.post(
  "/:id/reverse",
  authorize("accounting.reverse"),
  validate({ params: idParam, body: reasonBody }),
  async (req, res) => ok(res, await reverseGstVoucher(getCtx(req), params(req).id, body(req).reason))
);

// src/modules/presales/presales.routes.ts
import express, { Router as Router15 } from "express";
import cors from "cors";
import rateLimit2 from "express-rate-limit";
import { z as z22 } from "zod";

// src/modules/presales/presales.service.ts
import { randomBytes as randomBytes2 } from "crypto";
import PDFDocument2 from "pdfkit";
import { Types as Types14 } from "mongoose";
function waNumber(phone3) {
  const digits = phone3.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits;
}
function fillTemplate(body2, vars) {
  return body2.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, key) => vars[key] ?? m);
}
async function bookingVars(ctx, bookingId) {
  const booking = await Booking.findOne({ ...scopedFilter(ctx), _id: bookingId }).lean();
  if (!booking) throw notFound("Booking");
  const [items, open] = await Promise.all([
    BookingItem.find({ companyId: ctx.companyId, bookingId, active: true }).select("plotNumber blockCode").lean(),
    Installment.find({ companyId: ctx.companyId, bookingId, status: { $in: ["pending", "partial"] } }).sort({ dueDate: 1 }).lean()
  ]);
  const today = parseISODate(todayInIndia());
  const due = open.filter((i) => i.dueDate <= today).reduce((s, i) => s + i.amountPaise - i.paidPaise, 0);
  const next = open[0];
  return {
    booking,
    vars: {
      booking_no: booking.bookingNumber,
      units: items.map((i) => i.blockCode ? `${i.blockCode}-${i.plotNumber}` : i.plotNumber).join(", "),
      amount_due: formatINR(due || (next ? next.amountPaise - next.paidPaise : 0)),
      due_date: next ? formatDate(toISODate(next.dueDate)) : "",
      total_amount: formatINR(booking.netAmountPaise)
    }
  };
}
async function renderWhatsapp(ctx, templateId, input) {
  const tpl = await WhatsappTemplate.findOne({ companyId: ctx.companyId, deletedAt: null, _id: toObjectId(templateId) }).lean();
  if (!tpl) throw notFound("Template");
  const [company, me] = await Promise.all([
    Company.findById(ctx.companyId).select("name").lean(),
    User.findById(ctx.userId).select("name").lean()
  ]);
  const vars = { company: company?.name ?? "", executive: me?.name ?? "" };
  let phone3 = "";
  let leadId;
  let booking;
  const id = toObjectId(input.entityId);
  if (input.entityType === "lead") {
    if (!hasPermission(ctx, "crm.read")) throw forbidden();
    const lead = await Lead.findOne({ ...leadVisibility(ctx), _id: id }).populate({ path: "projectId", select: "name", match: { companyId: ctx.companyId } }).lean();
    if (!lead) throw notFound("Lead");
    Object.assign(vars, { name: lead.name, phone: lead.phone, project: lead.projectId?.name ?? "" });
    phone3 = lead.phone;
    leadId = lead._id;
  } else {
    if (!hasPermission(ctx, input.entityType === "booking" ? "bookings.read" : "customers.read")) throw forbidden();
    let customerId = id;
    if (input.entityType === "booking") {
      const b = await bookingVars(ctx, id);
      Object.assign(vars, b.vars);
      booking = b.booking;
      customerId = b.booking.customerId;
      const project = await Project.findOne({ companyId: ctx.companyId, _id: b.booking.projectId }).select("name").lean();
      vars.project = project?.name ?? "";
    }
    const customer = await Customer.findOne({ companyId: ctx.companyId, _id: customerId, deletedAt: null }).lean();
    if (!customer) throw notFound("Customer");
    Object.assign(vars, { name: customer.name, phone: customer.phone });
    phone3 = customer.phone;
  }
  const text = fillTemplate(tpl.body, vars);
  const url = `https://wa.me/${waNumber(phone3)}?text=${encodeURIComponent(text)}`;
  if (input.log) {
    if (leadId) {
      await LeadActivity.create({
        companyId: ctx.companyId,
        leadId,
        type: "whatsapp",
        summary: `WhatsApp sent: ${tpl.name}`,
        actorId: ctx.userId,
        completedAt: /* @__PURE__ */ new Date()
      });
      await Lead.updateOne({ companyId: ctx.companyId, _id: leadId }, { $set: { lastActivityAt: /* @__PURE__ */ new Date() } });
    } else if (booking) {
      await CollectionFollowUp.create({
        companyId: ctx.companyId,
        projectId: booking.projectId,
        bookingId: booking._id,
        customerId: booking.customerId,
        type: "whatsapp",
        note: `WhatsApp sent: ${tpl.name}`,
        createdBy: ctx.userId
      });
    }
    await WhatsappTemplate.updateOne({ companyId: ctx.companyId, _id: tpl._id }, { $inc: { timesUsed: 1 } });
  }
  return { phone: phone3, text, url, missing: [...text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]) };
}
var newToken = () => randomBytes2(24).toString("base64url");
var FIELD_ALIASES = {
  name: [
    "name",
    "full_name",
    "fullname",
    "contact_name",
    "customer_name",
    "sender_name",
    "lead_name",
    "first_name",
    "buyer_name",
    "username"
  ],
  phone: ["phone", "mobile", "mobile_number", "phone_number", "contact_number", "contact", "sender_mobile", "mobileno", "cell", "whatsapp"],
  email: ["email", "email_id", "emailid", "sender_email", "mail"],
  message: ["message", "query", "comments", "comment", "remarks", "requirement", "enquiry", "enquiry_message", "description", "notes"],
  project: ["project", "project_name", "property", "property_name", "listing", "listing_title", "subject"],
  budget: ["budget", "price", "max_budget"]
};
function flatten(obj, out = {}, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 3) return out;
  for (const [k, v] of Object.entries(obj)) {
    const key = k.toLowerCase().replace(/[\s-]+/g, "_");
    if (v !== null && typeof v === "object" && !Array.isArray(v)) flatten(v, out, depth + 1);
    else if (Array.isArray(v)) {
      for (const item of v) {
        if (item && typeof item === "object" && "name" in item && "values" in item) {
          const it = item;
          out[it.name.toLowerCase().replace(/[\s-]+/g, "_")] = String(it.values?.[0] ?? "");
        } else flatten(item, out, depth + 1);
      }
    } else if (v !== void 0 && !(key in out)) out[key] = String(v).slice(0, 1e3);
  }
  return out;
}
function mapInboundPayload(payload) {
  const flat = flatten(payload);
  const pick = (aliases) => {
    for (const a of aliases) if (flat[a]?.trim()) return flat[a].trim();
    return void 0;
  };
  let name = pick(FIELD_ALIASES.name);
  if (name && flat.last_name && !flat.full_name && name === flat.first_name) name = `${name} ${flat.last_name}`.trim();
  const rawPhone = pick(FIELD_ALIASES.phone);
  const phone3 = rawPhone?.replace(/[^\d+]/g, "");
  return {
    name,
    phone: phone3,
    email: pick(FIELD_ALIASES.email),
    message: pick(FIELD_ALIASES.message),
    project: pick(FIELD_ALIASES.project),
    budget: pick(FIELD_ALIASES.budget)
  };
}
async function receiveInboundLead(token, payload, ip) {
  const integration = await PortalIntegration.findOne({ token, deletedAt: null }, null, { crossTenant: true }).lean();
  if (!integration || !integration.isActive) return { status: 404 };
  const companyId = integration.companyId;
  const mapped = mapInboundPayload(payload);
  const raw = JSON.stringify(payload ?? {}).slice(0, 4e3);
  const log = (outcome, extra = {}) => InboundLog.create({
    companyId,
    integrationId: integration._id,
    outcome,
    name: mapped.name,
    phone: mapped.phone,
    payload: raw,
    ip,
    ...extra
  });
  if (!mapped.phone || mapped.phone.replace(/\D/g, "").length < 7) {
    await log("rejected", { error: "No phone number found in the payload" });
    return { status: 422, error: "A phone number is required" };
  }
  const name = mapped.name || "Portal enquiry";
  const settings = await getLeadSettings(companyId);
  const source = settings.sources.some((s) => s.key === integration.portal) ? integration.portal : "other";
  const actorId = integration.createdBy ?? integration.defaultAssigneeId;
  const summary = [`Enquiry via ${integration.name}`, mapped.project && `for ${mapped.project}`, mapped.message && `\u2013 ${mapped.message}`].filter(Boolean).join(" ").slice(0, 1e3);
  const digits = mapped.phone.replace(/\D/g, "").slice(-10);
  const existing = await Lead.findOne({
    companyId,
    deletedAt: null,
    status: { $in: OPEN_LEAD_STATUSES },
    phone: new RegExp(`${digits}$`)
  }).lean();
  if (existing) {
    await LeadActivity.create({
      companyId,
      leadId: existing._id,
      type: "note",
      summary: `Repeat enquiry: ${summary}`,
      actorId,
      completedAt: /* @__PURE__ */ new Date()
    });
    await Lead.updateOne({ companyId, _id: existing._id }, { $set: { lastActivityAt: /* @__PURE__ */ new Date() } });
    await PortalIntegration.updateOne(
      { companyId, _id: integration._id },
      { $inc: { duplicates: 1 }, $set: { lastReceivedAt: /* @__PURE__ */ new Date() } }
    );
    await log("duplicate", { leadId: existing._id });
    return { status: 200, leadId: String(existing._id), duplicate: true };
  }
  const lead = await Lead.create({
    companyId,
    projectId: integration.projectId,
    name: name.slice(0, 120),
    phone: mapped.phone.slice(0, 20),
    email: mapped.email?.slice(0, 254),
    source,
    status: "new",
    assignedTo: integration.defaultAssigneeId,
    nextFollowUpAt: /* @__PURE__ */ new Date(),
    notes: mapped.message?.slice(0, 1e3),
    lastActivityAt: /* @__PURE__ */ new Date(),
    createdBy: actorId
  });
  await LeadActivity.create({ companyId, leadId: lead._id, type: "note", summary, actorId, completedAt: /* @__PURE__ */ new Date() });
  await PortalIntegration.updateOne(
    { companyId, _id: integration._id },
    { $inc: { leadsReceived: 1 }, $set: { lastReceivedAt: /* @__PURE__ */ new Date() } }
  );
  if (integration.defaultAssigneeId) {
    await Notification.create({
      companyId,
      userId: integration.defaultAssigneeId,
      type: "lead_assigned",
      title: `New ${integration.name} lead: ${lead.name}`,
      body: mapped.message?.slice(0, 200),
      link: `/pre-sales/leads?lead=${lead._id}`
    });
  }
  await log("created", { leadId: lead._id });
  return { status: 201, leadId: String(lead._id), duplicate: false };
}
async function integrationLogs(ctx, id) {
  const integration = await PortalIntegration.findOne({ companyId: ctx.companyId, deletedAt: null, _id: toObjectId(id) }).lean();
  if (!integration) throw notFound("Integration");
  return InboundLog.find({ companyId: ctx.companyId, integrationId: integration._id }).sort({ createdAt: -1 }).limit(50).lean();
}
async function rotateToken(ctx, id) {
  const token = newToken();
  const res = await PortalIntegration.updateOne({ companyId: ctx.companyId, deletedAt: null, _id: toObjectId(id) }, { $set: { token } });
  if (res.matchedCount !== 1) throw notFound("Integration");
  await audit(ctx, { action: "integration.rotate", entityType: "integration", entityId: id });
  return { token };
}
async function checkProspect(ctx, input) {
  if (input.leadId && !await Lead.exists({ ...leadVisibility(ctx), _id: toObjectId(input.leadId) })) throw badRequest("Lead not found");
  if (input.customerId && !await Customer.exists({ companyId: ctx.companyId, _id: toObjectId(input.customerId), deletedAt: null })) {
    throw badRequest("Customer not found");
  }
}
async function createQuotation(ctx, input) {
  if (input.discountPaise > 0 && !hasPermission(ctx, "bookings.discount")) throw forbidden("You are not allowed to give discounts");
  await checkProspect(ctx, input);
  const priced = await quote(ctx, {
    projectId: input.projectId,
    plotIds: input.plotIds,
    paymentPlanId: input.paymentPlanId,
    bookingDate: input.quoteDate,
    discountPaise: input.discountPaise,
    charges: input.charges
  });
  if (priced.unavailable.length) {
    throw businessRule(`Not available: ${priced.unavailable.map((u) => `${u.plotNumber} (${u.status})`).join(", ")}`);
  }
  const company = await Company.findById(ctx.companyId).select("settings").lean();
  const validUntil = input.validUntil ?? addDays(input.quoteDate, company?.settings?.quotationValidityDays ?? 15);
  if (validUntil < input.quoteDate) throw badRequest("Validity cannot end before the quotation date");
  return withTransaction(async (session) => {
    const number = await nextDocumentNumber(ctx.companyId, "QTN", input.quoteDate, session);
    const [q] = await Quotation.create(
      [
        {
          companyId: ctx.companyId,
          projectId: toObjectId(input.projectId),
          number,
          leadId: input.leadId ? toObjectId(input.leadId) : void 0,
          customerId: input.customerId ? toObjectId(input.customerId) : void 0,
          prospectName: input.prospectName,
          prospectPhone: input.prospectPhone,
          quoteDate: parseISODate(input.quoteDate),
          validUntil: parseISODate(validUntil),
          paymentPlanId: toObjectId(input.paymentPlanId),
          planName: priced.planName,
          plotIds: input.plotIds.map(toObjectId),
          items: priced.items,
          grossAmountPaise: priced.grossAmountPaise,
          discountPaise: priced.discountPaise,
          charges: priced.charges,
          chargesTotalPaise: priced.chargesTotalPaise,
          netAmountPaise: priced.netAmountPaise,
          schedule: priced.schedule,
          notes: input.notes,
          createdBy: ctx.userId
        }
      ],
      { session }
    );
    if (input.leadId) {
      await LeadActivity.create(
        [
          {
            companyId: ctx.companyId,
            leadId: toObjectId(input.leadId),
            type: "note",
            summary: `Quotation ${number} for ${formatINR(priced.netAmountPaise)}`,
            actorId: ctx.userId,
            completedAt: /* @__PURE__ */ new Date()
          }
        ],
        { session }
      );
    }
    await audit(
      ctx,
      { action: "quotations.create", entityType: "quotation", entityId: q._id, summary: `${number} ${formatINR(priced.netAmountPaise)}` },
      session
    );
    return q.toJSON();
  });
}
var QUOTE_POPULATE = (ctx) => [
  { path: "projectId", select: "name code reraNumber", match: { companyId: ctx.companyId } },
  { path: "leadId", select: "name phone", match: { companyId: ctx.companyId } },
  { path: "customerId", select: "name phone customerCode", match: { companyId: ctx.companyId } },
  { path: "bookingId", select: "bookingNumber", match: { companyId: ctx.companyId } },
  { path: "createdBy", select: "name" }
];
function withExpiry(q) {
  if (["draft", "sent", "accepted"].includes(q.status) && toISODate(q.validUntil) < todayInIndia()) return { ...q, status: "expired" };
  return q;
}
async function listQuotations(ctx, q) {
  const filter = scopedFilter(ctx, q.projectId);
  const today = parseISODate(todayInIndia());
  if (q.status === "expired") Object.assign(filter, { status: { $in: ["draft", "sent", "accepted"] }, validUntil: { $lt: today } });
  else if (q.status && ["draft", "sent", "accepted"].includes(q.status))
    Object.assign(filter, { status: q.status, validUntil: { $gte: today } });
  else if (q.status) filter.status = q.status;
  if (q.leadId) filter.leadId = toObjectId(q.leadId);
  if (q.customerId) filter.customerId = toObjectId(q.customerId);
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), "i");
    filter.$or = [{ number: rx }, { prospectName: rx }, { prospectPhone: rx }];
  }
  const sort = parseSort(q.sort, ["quoteDate", "netAmountPaise", "number", "validUntil"], { createdAt: -1 });
  const [items, total] = await Promise.all([
    Quotation.find(filter).sort(sort).skip((q.page - 1) * q.pageSize).limit(q.pageSize).select("-schedule").populate(QUOTE_POPULATE(ctx)).lean(),
    Quotation.countDocuments(filter)
  ]);
  return { items: items.map(withExpiry), meta: pageMeta(q.page, q.pageSize, total) };
}
async function getQuotation(ctx, id) {
  const q = await Quotation.findOne({ ...scopedFilter(ctx), _id: toObjectId(id) }).populate(QUOTE_POPULATE(ctx)).lean();
  if (!q) throw notFound("Quotation");
  return withExpiry(q);
}
var QUOTE_TRANSITIONS = {
  draft: ["sent", "accepted", "cancelled"],
  sent: ["accepted", "cancelled"],
  accepted: ["cancelled"]
};
async function setQuotationStatus(ctx, id, status) {
  const q = await getQuotation(ctx, id);
  if (q.status === "expired") throw businessRule("This quotation has expired; make a new one");
  if (!QUOTE_TRANSITIONS[q.status]?.includes(status)) throw businessRule(`A ${q.status} quotation cannot be marked ${status}`);
  const res = await Quotation.updateOne({ companyId: ctx.companyId, _id: q._id, status: q.status }, { $set: { status } });
  if (res.modifiedCount !== 1) throw businessRule("The quotation changed concurrently, please retry");
  await audit(ctx, { action: "quotations.status", entityType: "quotation", entityId: q._id, changes: { from: q.status, to: status } });
  return { id: String(q._id), status };
}
var rs2 = (paise2) => `Rs. ${formatINR(paise2, { symbol: false })}`;
async function quotationPdf(ctx, id, res) {
  const q = await getQuotation(ctx, id);
  const company = await Company.findById(ctx.companyId).lean();
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${q.number.replace(/[^\w.-]/g, "_")}.pdf"`);
  res.setHeader("Cache-Control", "private, no-store");
  const doc = new PDFDocument2({ size: "A4", margin: 50 });
  doc.pipe(res);
  doc.fontSize(16).font("Helvetica-Bold").text(company?.legalName || company?.name || "");
  doc.fontSize(9).font("Helvetica").fillColor("#555");
  const addr = [company?.address?.line1, company?.address?.city, company?.address?.state].filter(Boolean).join(", ");
  if (addr) doc.text(addr);
  if (company?.phone) doc.text(`Phone: ${company.phone}`);
  doc.moveDown(0.8).fillColor("#000").fontSize(13).font("Helvetica-Bold").text("COST SHEET / QUOTATION", { align: "center" }).moveDown(0.6);
  const row2 = (label, value) => {
    const y = doc.y;
    doc.fontSize(10).font("Helvetica-Bold").text(label, 50, y, { width: 160 });
    doc.font("Helvetica").text(value, 210, y, { width: 335 });
    doc.moveDown(0.3);
  };
  const prospect = q.customerId ?? q.leadId;
  row2("Quotation No.", q.number);
  row2("Date", formatDate(toISODate(q.quoteDate)));
  row2("Valid until", formatDate(toISODate(q.validUntil)));
  row2(
    "Prepared for",
    `${prospect?.name ?? q.prospectName ?? ""}${prospect?.phone ?? q.prospectPhone ? ` (${prospect?.phone ?? q.prospectPhone})` : ""}`
  );
  row2("Project", `${q.projectId?.name ?? ""}${q.projectId?.reraNumber ? ` \u2013 RERA ${q.projectId.reraNumber}` : ""}`);
  doc.moveDown(0.4).font("Helvetica-Bold").text("Unit pricing").font("Helvetica").moveDown(0.3);
  for (const i of q.items) {
    row2(
      `Unit ${i.blockCode ? `${i.blockCode}-` : ""}${i.plotNumber}`,
      `${areaToSqft(i.areaX100)} sq ft @ ${rs2(i.ratePaisePerSqft)}/sq ft${i.plcPaise ? ` + PLC ${rs2(i.plcPaise)}` : ""} = ${rs2(i.lineTotalPaise)}`
    );
  }
  row2("Unit value", rs2(q.grossAmountPaise));
  if (q.discountPaise) row2("Discount", `- ${rs2(q.discountPaise)}`);
  for (const c of q.charges) row2(c.name, rs2(c.amountPaise));
  doc.font("Helvetica-Bold");
  row2("Total cost", rs2(q.netAmountPaise));
  doc.moveDown(0.4).font("Helvetica-Bold").text(`Payment plan: ${q.planName}`).font("Helvetica").moveDown(0.3);
  for (const s of q.schedule) row2(`${s.sequence}. ${s.name}`, `${formatDate(s.dueDate)} \u2013 ${rs2(s.amountPaise)}`);
  if (q.notes) doc.moveDown(0.5).font("Helvetica-Bold").text("Notes").font("Helvetica").text(q.notes);
  doc.moveDown(1.5).fontSize(8).fillColor("#666").text(
    "Prices are subject to availability at the time of booking. Government taxes, stamp duty and registration charges extra unless stated.",
    { align: "center" }
  );
  doc.end();
}
async function salesDashboard(ctx, q) {
  const today = todayInIndia();
  const to = q.to ?? today;
  const from = q.from ?? `${to.slice(0, 7)}-01`;
  const fromD = parseISODate(from);
  const toEnd = new Date(parseISODate(to).getTime() + 864e5);
  const leadBase = { ...leadVisibility(ctx) };
  if (q.projectId) {
    assertProjectAccess(ctx, q.projectId);
    leadBase.projectId = toObjectId(q.projectId);
  }
  const bookingBase = scopedFilter(ctx, q.projectId);
  const inPeriod = { createdAt: { $gte: fromD, $lt: toEnd } };
  const twelveWeeksAgo = new Date(toEnd.getTime() - 12 * 7 * 864e5);
  const endOfToday = new Date(parseISODate(today).getTime() + 864e5);
  const [bySource, byStatus, pipeline, followUps, trendLeads, trendBookings, bookings, quotes, visits, execLeads, execBookings, settings] = await Promise.all([
    Lead.aggregate([
      { $match: { ...leadBase, ...inPeriod } },
      { $group: { _id: "$source", n: { $sum: 1 }, won: { $sum: { $cond: [{ $eq: ["$status", "won"] }, 1, 0] } } } },
      { $sort: { n: -1 } }
    ]),
    Lead.aggregate([
      { $match: { ...leadBase, ...inPeriod } },
      { $group: { _id: "$status", n: { $sum: 1 } } }
    ]),
    Lead.aggregate([
      { $match: { ...leadBase, status: { $in: OPEN_LEAD_STATUSES } } },
      { $group: { _id: "$status", n: { $sum: 1 } } }
    ]),
    Lead.aggregate([
      { $match: { ...leadBase, status: { $in: OPEN_LEAD_STATUSES }, nextFollowUpAt: { $lt: endOfToday } } },
      {
        $group: {
          _id: null,
          overdue: { $sum: { $cond: [{ $lt: ["$nextFollowUpAt", parseISODate(today)] }, 1, 0] } },
          today: { $sum: { $cond: [{ $gte: ["$nextFollowUpAt", parseISODate(today)] }, 1, 0] } }
        }
      }
    ]),
    Lead.aggregate([
      { $match: { ...leadBase, createdAt: { $gte: twelveWeeksAgo, $lt: toEnd } } },
      { $group: { _id: { $dateToString: { format: "%G-W%V", date: "$createdAt", timezone: "Asia/Kolkata" } }, n: { $sum: 1 } } }
    ]),
    Booking.aggregate([
      { $match: { ...bookingBase, bookingDate: { $gte: twelveWeeksAgo, $lt: toEnd }, status: { $in: ["reserved", "booked"] } } },
      {
        $group: {
          _id: { $dateToString: { format: "%G-W%V", date: "$bookingDate" } },
          n: { $sum: 1 },
          value: { $sum: "$netAmountPaise" }
        }
      }
    ]),
    Booking.aggregate([
      { $match: { ...bookingBase, bookingDate: { $gte: fromD, $lt: toEnd } } },
      {
        $group: {
          _id: null,
          n: { $sum: { $cond: [{ $in: ["$status", ["reserved", "booked"]] }, 1, 0] } },
          value: { $sum: { $cond: [{ $in: ["$status", ["reserved", "booked"]] }, "$netAmountPaise", 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] } }
        }
      }
    ]),
    Quotation.aggregate([
      { $match: { ...bookingBase, quoteDate: { $gte: fromD, $lt: toEnd } } },
      {
        $group: {
          _id: null,
          n: { $sum: 1 },
          value: { $sum: "$netAmountPaise" },
          converted: { $sum: { $cond: [{ $eq: ["$status", "converted"] }, 1, 0] } }
        }
      }
    ]),
    LeadActivity.countDocuments({ companyId: ctx.companyId, type: "site_visit", createdAt: { $gte: fromD, $lt: toEnd } }),
    Lead.aggregate([
      { $match: { ...leadBase, ...inPeriod } },
      {
        $group: {
          _id: "$assignedTo",
          total: { $sum: 1 },
          open: { $sum: { $cond: [{ $in: ["$status", OPEN_LEAD_STATUSES] }, 1, 0] } },
          won: { $sum: { $cond: [{ $eq: ["$status", "won"] }, 1, 0] } }
        }
      }
    ]),
    Booking.aggregate([
      { $match: { ...bookingBase, bookingDate: { $gte: fromD, $lt: toEnd }, status: { $in: ["reserved", "booked"] } } },
      { $group: { _id: "$createdBy", n: { $sum: 1 }, value: { $sum: "$netAmountPaise" } } }
    ]),
    getLeadSettings(ctx.companyId)
  ]);
  const userIds = [...new Set([...execLeads.map((e) => e._id), ...execBookings.map((e) => e._id)].filter(Boolean).map(String))];
  const [users, members] = await Promise.all([
    User.find({ _id: { $in: userIds.map((i) => new Types14.ObjectId(i)) } }).select("name").lean(),
    Membership.find({ companyId: ctx.companyId, userId: { $in: userIds.map((i) => new Types14.ObjectId(i)) } }).select("userId").lean()
  ]);
  const memberSet = new Set(members.map((m) => String(m.userId)));
  const names = new Map(users.filter((u) => memberSet.has(String(u._id))).map((u) => [String(u._id), u.name]));
  const execMap = /* @__PURE__ */ new Map();
  for (const e of execLeads) {
    const key = e._id ? String(e._id) : "unassigned";
    execMap.set(key, {
      userId: e._id ? String(e._id) : null,
      name: e._id ? names.get(String(e._id)) ?? "Former user" : "Unassigned",
      leads: e.total,
      open: e.open,
      won: e.won,
      bookings: 0,
      valuePaise: 0
    });
  }
  for (const b of execBookings) {
    const key = String(b._id);
    const row2 = execMap.get(key) ?? {
      userId: key,
      name: names.get(key) ?? "Former user",
      leads: 0,
      open: 0,
      won: 0,
      bookings: 0,
      valuePaise: 0
    };
    row2.bookings = b.n;
    row2.valuePaise = b.value;
    execMap.set(key, row2);
  }
  const totalLeads = bySource.reduce((s, r) => s + r.n, 0);
  const won = byStatus.find((s) => s._id === "won")?.n ?? 0;
  const label = (k) => settings.sources.find((s) => s.key === k)?.label ?? k;
  const weeks = /* @__PURE__ */ new Map();
  for (const t of trendLeads) weeks.set(t._id, { week: t._id, leads: t.n, bookings: 0, valuePaise: 0 });
  for (const t of trendBookings) {
    const w = weeks.get(t._id) ?? { week: t._id, leads: 0, bookings: 0, valuePaise: 0 };
    w.bookings = t.n;
    w.valuePaise = t.value;
    weeks.set(t._id, w);
  }
  return {
    from,
    to,
    kpis: {
      leads: totalLeads,
      won,
      conversionBp: totalLeads ? Math.round(won * 1e4 / totalLeads) : 0,
      siteVisits: visits,
      bookings: bookings[0]?.n ?? 0,
      bookingValuePaise: bookings[0]?.value ?? 0,
      cancellations: bookings[0]?.cancelled ?? 0,
      quotations: quotes[0]?.n ?? 0,
      quotationValuePaise: quotes[0]?.value ?? 0,
      quotationsConverted: quotes[0]?.converted ?? 0,
      followUpsOverdue: followUps[0]?.overdue ?? 0,
      followUpsToday: followUps[0]?.today ?? 0
    },
    bySource: bySource.map((s) => ({ source: s._id, label: label(s._id), leads: s.n, won: s.won })),
    byStatus: byStatus.map((s) => ({ status: s._id, label: settings.stageLabels[s._id] ?? s._id, leads: s.n })),
    pipeline: OPEN_LEAD_STATUSES.map((s) => ({
      status: s,
      label: settings.stageLabels[s] ?? s,
      leads: pipeline.find((p) => p._id === s)?.n ?? 0
    })),
    trend: [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week)),
    executives: [...execMap.values()].sort((a, b) => b.valuePaise - a.valuePaise || b.won - a.won)
  };
}

// src/modules/presales/presales.routes.ts
var leadSettingsRouter = Router15();
leadSettingsRouter.get("/", authorize("crm.read"), async (req, res) => ok(res, await getLeadSettings(getCtx(req).companyId)));
leadSettingsRouter.put(
  "/",
  authorize("crm.configure"),
  validate({ body: leadSettingsSchema }),
  async (req, res) => ok(res, await saveLeadSettings(getCtx(req).companyId, body(req)))
);
var whatsappTemplatesRouter = crudRouter({
  model: WhatsappTemplate,
  entity: "Template",
  auditType: "whatsapp_template",
  createSchema: whatsappTemplateSchema,
  updateSchema: patchSchema(whatsappTemplateSchema),
  permissions: { read: "crm.read", create: "crm.configure", update: "crm.configure", delete: "crm.configure" },
  searchFields: ["name", "body"],
  sortFields: ["name", "category", "timesUsed", "createdAt"],
  defaultSort: { category: 1, name: 1 },
  filter: (q) => q.kind ? { category: q.kind } : {},
  extend: (r) => {
    r.post(
      "/:id/render",
      validate({ params: idParam, body: whatsappRenderSchema }),
      async (req, res) => ok(res, await renderWhatsapp(getCtx(req), params(req).id, body(req)))
    );
  }
});
async function prepareIntegration(ctx, input) {
  const i = input;
  if (i.projectId) await assertRefs(ctx, Project, [i.projectId], "Project", { project: true });
  if (i.defaultAssigneeId && !await Membership.exists({ companyId: ctx.companyId, userId: toObjectId(i.defaultAssigneeId), status: "active" })) {
    throw badRequest("Assignee is not an active member of this company");
  }
  return input;
}
var integrationsRouter = crudRouter({
  model: PortalIntegration,
  entity: "Integration",
  auditType: "integration",
  createSchema: portalIntegrationSchema.transform((v) => ({ ...v, token: newToken() })),
  updateSchema: patchSchema(portalIntegrationSchema),
  permissions: { read: "crm.configure", create: "crm.configure", update: "crm.configure", delete: "crm.configure" },
  searchFields: ["name", "portal"],
  sortFields: ["name", "portal", "leadsReceived", "lastReceivedAt", "createdAt"],
  defaultSort: { createdAt: -1 },
  populate: [
    { path: "projectId", select: "name code" },
    { path: "defaultAssigneeId", select: "name" }
  ],
  prepare: prepareIntegration,
  extend: (r) => {
    r.get(
      "/:id/logs",
      authorize("crm.configure"),
      validate({ params: idParam }),
      async (req, res) => ok(res, await integrationLogs(getCtx(req), params(req).id))
    );
    r.post(
      "/:id/rotate",
      authorize("crm.configure"),
      validate({ params: idParam }),
      async (req, res) => ok(res, await rotateToken(getCtx(req), params(req).id))
    );
    r.post(
      "/:id/test",
      authorize("crm.configure"),
      validate({
        params: idParam,
        body: z22.object({ name: z22.string().max(120), phone: z22.string().max(20), message: z22.string().max(500).optional() })
      }),
      async (req, res) => {
        const ctx = getCtx(req);
        const integration = await PortalIntegration.findOne({
          companyId: ctx.companyId,
          deletedAt: null,
          _id: toObjectId(params(req).id)
        }).lean();
        if (!integration) throw badRequest("Integration not found");
        const result = await receiveInboundLead(integration.token, body(req), req.ip);
        ok(res, result);
      }
    );
  }
});
var inboundRouter = Router15();
inboundRouter.use(cors({ origin: true, credentials: false, methods: ["POST", "OPTIONS"] }));
inboundRouter.use(rateLimit2({ windowMs: 6e4, limit: 60, standardHeaders: "draft-7", legacyHeaders: false }));
inboundRouter.post("/:token", express.urlencoded({ extended: false, limit: "100kb" }), async (req, res) => {
  const token = String(req.params.token ?? "");
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Not found" } });
    return;
  }
  const result = await receiveInboundLead(token, req.body, req.ip);
  if (result.status === 404) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Not found" } });
    return;
  }
  if (result.status === 422) {
    res.status(422).json({ success: false, error: { code: "VALIDATION_ERROR", message: result.error } });
    return;
  }
  if (req.is("application/x-www-form-urlencoded") && req.accepts(["json", "html"]) === "html") {
    res.status(200).type("text/plain").send("Thank you! We will contact you shortly.");
    return;
  }
  res.status(result.status).json({ success: true, data: { received: true, duplicate: result.duplicate } });
});
var quotationsRouter = Router15();
quotationsRouter.get("/", authorize("quotations.read"), validate({ query: quotationListQuerySchema }), async (req, res) => {
  const { items, meta: meta2 } = await listQuotations(getCtx(req), query(req));
  ok(res, items, meta2);
});
quotationsRouter.post(
  "/",
  authorize("quotations.create"),
  validate({ body: quotationSchema }),
  async (req, res) => created(res, await createQuotation(getCtx(req), body(req)))
);
quotationsRouter.get(
  "/:id",
  authorize("quotations.read"),
  validate({ params: idParam }),
  async (req, res) => ok(res, await getQuotation(getCtx(req), params(req).id))
);
quotationsRouter.get("/:id/pdf", authorize("quotations.read"), validate({ params: idParam }), async (req, res) => {
  await quotationPdf(getCtx(req), params(req).id, res);
});
quotationsRouter.post(
  "/:id/status",
  authorize("quotations.update"),
  validate({ params: idParam, body: quotationStatusSchema }),
  async (req, res) => ok(res, await setQuotationStatus(getCtx(req), params(req).id, body(req).status))
);
var salesDashboardRouter = Router15();
salesDashboardRouter.get(
  "/",
  authorize("crm.read"),
  validate({ query: salesDashboardQuerySchema }),
  async (req, res) => ok(res, await salesDashboard(getCtx(req), query(req)))
);

// src/modules/postsales/postsales.routes.ts
import { Router as Router16 } from "express";
import { z as z23 } from "zod";

// src/modules/postsales/postsales.service.ts
import PDFDocument3 from "pdfkit";
var day2 = (d) => parseISODate(d ?? todayInIndia());
var iso = (d) => d ? toISODate(d) : "";
async function loadBooking(ctx, id, session) {
  const booking = await Booking.findOne({ companyId: ctx.companyId, _id: toObjectId(id) }).session(session ?? null).lean();
  if (!booking) throw notFound("Booking");
  assertProjectAccess(ctx, booking.projectId);
  return booking;
}
async function outstanding(ctx, bookingId, dueBy, session) {
  const filter = { companyId: ctx.companyId, bookingId, status: { $in: ["pending", "partial"] } };
  if (dueBy) filter.dueDate = { $lte: dueBy };
  const rows = await Installment.find(filter).sort({ dueDate: 1, sequence: 1 }).session(session ?? null).lean();
  return { rows, totalPaise: rows.reduce((s, r) => s + r.amountPaise - r.paidPaise, 0) };
}
async function setBookingLoan(ctx, bookingId, input) {
  const booking = await loadBooking(ctx, bookingId);
  if (!["reserved", "booked"].includes(booking.status)) throw businessRule(`This booking is ${booking.status}`);
  if (input) {
    if (!await Financer.exists({ companyId: ctx.companyId, deletedAt: null, _id: toObjectId(input.financerId) }))
      throw badRequest("Lender not found");
    if (input.disbursedPaise && input.sanctionedPaise && input.disbursedPaise > input.sanctionedPaise) {
      throw badRequest("Disbursed amount cannot exceed the sanctioned amount");
    }
  }
  const loan = input ? { ...input, financerId: toObjectId(input.financerId), sanctionDate: input.sanctionDate ? day2(input.sanctionDate) : void 0 } : void 0;
  await Booking.updateOne({ companyId: ctx.companyId, _id: booking._id }, loan ? { $set: { loan } } : { $unset: { loan: 1 } });
  await audit(ctx, { action: "bookings.loan", entityType: "booking", entityId: booking._id, changes: { loan: input } });
  return { id: String(booking._id), loan: loan ?? null };
}
async function markAllotmentIssued(ctx, bookingId, issued, via) {
  const booking = await loadBooking(ctx, bookingId);
  if (booking.status !== "booked") throw businessRule("Allotment letters are issued for confirmed bookings");
  const update = issued ? { $set: { allotment: { issuedAt: /* @__PURE__ */ new Date(), issuedBy: ctx.userId, deliveredVia: via } } } : { $unset: { allotment: 1 } };
  await Booking.updateOne({ companyId: ctx.companyId, _id: booking._id }, update);
  await audit(ctx, {
    action: issued ? "postsales.allotment_issued" : "postsales.allotment_unissued",
    entityType: "booking",
    entityId: booking._id
  });
  return { id: String(booking._id), issued };
}
async function unitsByBooking(ctx, bookingIds, activeOnly = true) {
  const filter = { companyId: ctx.companyId, bookingId: { $in: bookingIds } };
  if (activeOnly) filter.active = true;
  const items = await BookingItem.find(filter).select("bookingId plotNumber blockCode").lean();
  const map = /* @__PURE__ */ new Map();
  for (const i of items)
    map.set(String(i.bookingId), [...map.get(String(i.bookingId)) ?? [], i.blockCode ? `${i.blockCode}-${i.plotNumber}` : i.plotNumber]);
  return map;
}
var BOOKING_POP = (ctx) => [
  { path: "customerId", select: "name phone customerCode", match: { companyId: ctx.companyId } },
  { path: "projectId", select: "name code", match: { companyId: ctx.companyId } }
];
async function listAllotments(ctx, q) {
  const filter = { ...scopedFilter(ctx, q.projectId), status: "booked" };
  if (q.issued === "true") filter["allotment.issuedAt"] = { $ne: null };
  if (q.issued === "false") filter["allotment.issuedAt"] = null;
  if (q.q) filter.bookingNumber = new RegExp(escapeRegex(q.q), "i");
  const sort = parseSort(q.sort, ["bookingDate", "bookingNumber", "netAmountPaise"], { bookingDate: -1 });
  const [items, total, counts] = await Promise.all([
    Booking.find(filter).sort(sort).skip((q.page - 1) * q.pageSize).limit(q.pageSize).select("bookingNumber bookingDate netAmountPaise receivedPaise allotment customerId projectId status").populate(BOOKING_POP(ctx)).populate("allotment.issuedBy", "name").lean(),
    Booking.countDocuments(filter),
    Booking.aggregate([
      { $match: { ...scopedFilter(ctx, q.projectId), status: "booked" } },
      {
        $group: {
          _id: null,
          issued: { $sum: { $cond: [{ $ifNull: ["$allotment.issuedAt", false] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $ifNull: ["$allotment.issuedAt", false] }, 0, 1] } }
        }
      }
    ])
  ]);
  const units = await unitsByBooking(
    ctx,
    items.map((i) => i._id)
  );
  return {
    items: items.map((i) => ({ ...i, units: units.get(String(i._id)) ?? [] })),
    meta: pageMeta(q.page, q.pageSize, total),
    summary: { issued: counts[0]?.issued ?? 0, pending: counts[0]?.pending ?? 0 }
  };
}
async function listCancellations(ctx, q) {
  const filter = { ...scopedFilter(ctx, q.projectId), status: { $in: ["cancelled", "expired"] } };
  if (q.refund === "pending") filter.$expr = { $gt: ["$refundablePaise", "$refundedPaise"] };
  if (q.refund === "settled") filter.$expr = { $lte: ["$refundablePaise", "$refundedPaise"] };
  if (q.q) filter.bookingNumber = new RegExp(escapeRegex(q.q), "i");
  const sort = parseSort(q.sort, ["closedAt", "bookingNumber", "refundablePaise"], { closedAt: -1 });
  const [items, total, totals] = await Promise.all([
    Booking.find(filter).sort(sort).skip((q.page - 1) * q.pageSize).limit(q.pageSize).select(
      "bookingNumber bookingDate status closedAt cancellation netAmountPaise receivedPaise refundablePaise refundedPaise customerId projectId"
    ).populate(BOOKING_POP(ctx)).populate("cancellation.by", "name").lean(),
    Booking.countDocuments(filter),
    Booking.aggregate([
      { $match: { ...scopedFilter(ctx, q.projectId), status: { $in: ["cancelled", "expired"] } } },
      {
        $group: {
          _id: null,
          n: { $sum: 1 },
          charges: { $sum: { $ifNull: ["$cancellation.chargePaise", 0] } },
          refundable: { $sum: "$refundablePaise" },
          refunded: { $sum: "$refundedPaise" }
        }
      }
    ])
  ]);
  const units = await unitsByBooking(
    ctx,
    items.map((i) => i._id),
    false
  );
  const t = totals[0];
  return {
    items: items.map((i) => ({ ...i, units: units.get(String(i._id)) ?? [] })),
    meta: pageMeta(q.page, q.pageSize, total),
    summary: {
      count: t?.n ?? 0,
      chargesPaise: t?.charges ?? 0,
      refundablePaise: t?.refundable ?? 0,
      refundedPaise: t?.refunded ?? 0,
      pendingRefundPaise: (t?.refundable ?? 0) - (t?.refunded ?? 0)
    }
  };
}
var BUCKETS = { "0_30": [1, 30], "31_60": [31, 60], "61_90": [61, 90], "90_plus": [91, 1e9] };
async function listDues(ctx, q) {
  const today = day2();
  const in30 = new Date(today.getTime() + 30 * 864e5);
  const base2 = { ...scopedFilter(ctx, q.projectId), status: { $in: ["pending", "partial"] } };
  const post = [];
  if (q.bucket === "upcoming") post.push({ overduePaise: 0, upcomingPaise: { $gt: 0 } });
  else if (BUCKETS[q.bucket]) post.push({ daysOverdue: { $gte: BUCKETS[q.bucket][0], $lte: BUCKETS[q.bucket][1] } });
  if (q.followUp === "due") post.push({ "lastFollowUp.nextFollowUpOn": { $lte: today } });
  if (q.followUp === "none") post.push({ lastFollowUp: null });
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), "i");
    post.push({ $or: [{ "customer.name": rx }, { "customer.phone": rx }, { "booking.bookingNumber": rx }] });
  }
  const sortField = (q.sort ?? "-overduePaise").replace(/^-/, "");
  const allowed = ["overduePaise", "outstandingPaise", "daysOverdue", "upcomingPaise"];
  const sort = { [allowed.includes(sortField) ? sortField : "overduePaise"]: q.sort?.startsWith("-") === false ? 1 : -1, _id: 1 };
  const pipeline = [
    { $match: base2 },
    { $addFields: { balance: { $subtract: ["$amountPaise", "$paidPaise"] } } },
    {
      $group: {
        _id: "$bookingId",
        customerId: { $first: "$customerId" },
        projectId: { $first: "$projectId" },
        outstandingPaise: { $sum: "$balance" },
        overduePaise: { $sum: { $cond: [{ $lt: ["$dueDate", today] }, "$balance", 0] } },
        upcomingPaise: { $sum: { $cond: [{ $and: [{ $gte: ["$dueDate", today] }, { $lte: ["$dueDate", in30] }] }, "$balance", 0] } },
        oldestOverdue: { $min: { $cond: [{ $lt: ["$dueDate", today] }, "$dueDate", null] } },
        nextDue: { $min: { $cond: [{ $gte: ["$dueDate", today] }, "$dueDate", null] } }
      }
    },
    { $match: { outstandingPaise: { $gt: 0 } } },
    {
      $addFields: {
        daysOverdue: {
          $cond: [
            { $ifNull: ["$oldestOverdue", false] },
            { $floor: { $divide: [{ $subtract: [today, "$oldestOverdue"] }, 864e5] } },
            0
          ]
        }
      }
    },
    {
      $lookup: {
        from: "collectionfollowups",
        let: { b: "$_id" },
        pipeline: [
          { $match: { $expr: { $and: [{ $eq: ["$bookingId", "$$b"] }, { $eq: ["$companyId", ctx.companyId] }] } } },
          { $sort: { createdAt: -1 } },
          { $limit: 1 }
        ],
        as: "lastFollowUp"
      }
    },
    { $addFields: { lastFollowUp: { $ifNull: [{ $first: "$lastFollowUp" }, null] } } },
    {
      $lookup: {
        from: "customers",
        let: { c: "$customerId" },
        pipeline: [
          { $match: { $expr: { $and: [{ $eq: ["$_id", "$$c"] }, { $eq: ["$companyId", ctx.companyId] }] } } },
          { $project: { name: 1, phone: 1, customerCode: 1 } }
        ],
        as: "customer"
      }
    },
    {
      $lookup: {
        from: "bookings",
        let: { b: "$_id" },
        pipeline: [
          { $match: { $expr: { $and: [{ $eq: ["$_id", "$$b"] }, { $eq: ["$companyId", ctx.companyId] }] } } },
          { $project: { bookingNumber: 1, status: 1, netAmountPaise: 1, receivedPaise: 1 } }
        ],
        as: "booking"
      }
    },
    { $addFields: { customer: { $first: "$customer" }, booking: { $first: "$booking" } } },
    { $match: { "booking.status": { $in: ["reserved", "booked"] } } },
    ...post.length ? [{ $match: { $and: post } }] : [],
    {
      $facet: {
        items: [{ $sort: sort }, { $skip: (q.page - 1) * q.pageSize }, { $limit: q.pageSize }],
        total: [{ $count: "n" }],
        totals: [
          {
            $group: {
              _id: null,
              overdue: { $sum: "$overduePaise" },
              outstanding: { $sum: "$outstandingPaise" },
              upcoming: { $sum: "$upcomingPaise" }
            }
          }
        ]
      }
    }
  ];
  const [res] = await Installment.aggregate(pipeline);
  const aging = await Installment.aggregate([
    { $match: { ...base2, dueDate: { $lt: today } } },
    { $group: { _id: "$bookingId", oldest: { $min: "$dueDate" }, amount: { $sum: { $subtract: ["$amountPaise", "$paidPaise"] } } } },
    { $match: { amount: { $gt: 0 } } },
    {
      $addFields: { days: { $floor: { $divide: [{ $subtract: [today, "$oldest"] }, 864e5] } } }
    },
    {
      $group: {
        _id: {
          $switch: {
            branches: [
              { case: { $lte: ["$days", 30] }, then: "0_30" },
              { case: { $lte: ["$days", 60] }, then: "31_60" },
              { case: { $lte: ["$days", 90] }, then: "61_90" }
            ],
            default: "90_plus"
          }
        },
        amount: { $sum: "$amount" },
        bookings: { $sum: 1 }
      }
    }
  ]);
  const t = res?.totals[0];
  return {
    items: (res?.items ?? []).map((r) => ({ ...r, bookingId: r._id, id: String(r._id) })),
    meta: pageMeta(q.page, q.pageSize, res?.total[0]?.n ?? 0),
    summary: {
      overduePaise: t?.overdue ?? 0,
      outstandingPaise: t?.outstanding ?? 0,
      upcomingPaise: t?.upcoming ?? 0,
      aging: Object.fromEntries(aging.map((a) => [a._id, { amountPaise: a.amount, bookings: a.bookings }]))
    }
  };
}
async function listFollowUps(ctx, bookingId) {
  const booking = await loadBooking(ctx, bookingId);
  return CollectionFollowUp.find({ companyId: ctx.companyId, bookingId: booking._id }).sort({ createdAt: -1 }).limit(100).populate("createdBy", "name").lean();
}
async function createFollowUp(ctx, input) {
  const booking = await loadBooking(ctx, input.bookingId);
  const f = await CollectionFollowUp.create({
    companyId: ctx.companyId,
    projectId: booking.projectId,
    bookingId: booking._id,
    customerId: booking.customerId,
    type: input.type,
    note: input.note,
    promisedAmountPaise: input.promisedAmountPaise,
    promisedOn: input.promisedOn ? day2(input.promisedOn) : void 0,
    nextFollowUpOn: input.nextFollowUpOn ? day2(input.nextFollowUpOn) : void 0,
    createdBy: ctx.userId
  });
  return f.toJSON();
}
async function companySettings(ctx) {
  const c = await Company.findById(ctx.companyId).select("settings").lean();
  return c?.settings;
}
async function duesGuard(ctx, kind, bookingId, override, remarks, session) {
  const settings = await companySettings(ctx);
  const required = kind === "registry" ? settings?.registryRequiresFullPayment ?? true : settings?.possessionRequiresFullPayment ?? true;
  const { totalPaise } = await outstanding(ctx, bookingId, void 0, session);
  if (required && totalPaise > 0) {
    if (!override)
      throw businessRule(
        `${formatINR(totalPaise)} is still outstanding on this booking. Collect it first, or proceed with an override and a remark.`
      );
    if (!remarks?.trim()) throw businessRule("Add a remark explaining why you are proceeding with dues outstanding");
  }
  return { outstandingPaise: totalPaise, overridden: required && totalPaise > 0 };
}
async function markUnitsSold(ctx, booking, session) {
  const items = await BookingItem.find({ companyId: ctx.companyId, bookingId: booking._id, active: true }).session(session).lean();
  for (const item of items) {
    const res = await Plot.updateOne(
      { companyId: ctx.companyId, _id: item.plotId, currentBookingId: booking._id, status: "booked" },
      { $set: { status: "sold" } },
      { session }
    );
    if (res.modifiedCount === 1) {
      await recordPlotStatus(
        ctx,
        {
          projectId: booking.projectId,
          plotId: item.plotId,
          from: "booked",
          to: "sold",
          reason: `Sale deed registered (${booking.bookingNumber})`,
          bookingId: booking._id
        },
        session
      );
    }
  }
}
function cleanDetails(details = {}) {
  const out = {};
  for (const [k, v] of Object.entries(details)) if (v !== void 0 && v !== "") out[k] = v;
  return out;
}
async function createSalesDocument(ctx, input) {
  return withTransaction(async (session) => {
    const booking = await loadBooking(ctx, input.bookingId, session);
    if (input.kind !== "demand" && booking.status !== "booked") throw businessRule("Confirm the booking first");
    if (input.kind === "demand" && !["reserved", "booked"].includes(booking.status))
      throw businessRule(`This booking is ${booking.status}`);
    if (input.kind !== "demand") {
      const active = await SalesDocument.exists({
        companyId: ctx.companyId,
        bookingId: booking._id,
        kind: input.kind,
        status: { $ne: "cancelled" }
      }).session(session);
      if (active)
        throw businessRule(
          `This booking already has an active ${input.kind === "agreement" ? "agreement" : input.kind === "registry" ? "registry" : "possession letter"}`
        );
    }
    let status = SALES_DOC_STATUSES[input.kind][0];
    let details = {};
    let amountPaise = 0;
    let guard;
    if (input.kind === "agreement") {
      details = cleanDetails(input.details);
      if (input.details.executedOn) status = "executed";
      if (input.details.registrationNumber && input.details.executedOn) status = "registered";
      amountPaise = (input.details.stampDutyPaise ?? 0) + (input.details.registrationFeePaise ?? 0);
    } else if (input.kind === "registry") {
      if (input.details.consultantId && !await Consultant.exists({ companyId: ctx.companyId, _id: toObjectId(input.details.consultantId) }).session(session)) {
        throw badRequest("Consultant not found");
      }
      guard = await duesGuard(ctx, "registry", booking._id, input.overrideDues, input.remarks, session);
      details = cleanDetails({
        ...input.details,
        consultantId: input.details.consultantId ? toObjectId(input.details.consultantId) : void 0
      });
      amountPaise = (input.details.stampDutyPaise ?? 0) + (input.details.registrationFeePaise ?? 0);
      if (input.details.registeredOn) {
        if (!input.details.deedNumber) throw badRequest("Enter the deed number of the registered sale deed");
        status = "registered";
      }
    } else if (input.kind === "possession") {
      guard = await duesGuard(ctx, "possession", booking._id, input.overrideDues, input.remarks, session);
      details = cleanDetails(input.details);
      if (input.details.handedOverOn) status = "handed_over";
    } else {
      const settings = await companySettings(ctx);
      const dueUpTo = input.dueUpTo ?? addDays(input.date, settings?.demandLeadDays ?? 15);
      const due = await outstanding(ctx, booking._id, day2(dueUpTo), session);
      if (due.totalPaise <= 0) throw businessRule("Nothing falls due on this booking by that date");
      details = {
        dueUpTo,
        payBy: input.payBy ?? addDays(input.date, 7),
        lines: due.rows.map((r) => ({
          installmentId: r._id,
          name: r.name,
          dueDate: iso(r.dueDate),
          amountPaise: r.amountPaise,
          paidPaise: r.paidPaise,
          balancePaise: r.amountPaise - r.paidPaise
        })),
        lateInterestBpPerMonth: settings?.lateInterestBpPerMonth ?? 0
      };
      amountPaise = due.totalPaise;
    }
    const number = await nextDocumentNumber(ctx.companyId, SALES_DOC_SERIES[input.kind], input.date, session);
    const [doc] = await SalesDocument.create(
      [
        {
          companyId: ctx.companyId,
          kind: input.kind,
          number,
          projectId: booking.projectId,
          bookingId: booking._id,
          customerId: booking.customerId,
          date: day2(input.date),
          status,
          details,
          amountPaise,
          outstandingAtCreationPaise: guard?.outstandingPaise,
          duesOverridden: guard?.overridden,
          remarks: input.remarks,
          history: [{ status, note: input.remarks, by: ctx.userId }],
          createdBy: ctx.userId
        }
      ],
      { session }
    );
    if (input.kind === "registry" && status === "registered") await markUnitsSold(ctx, booking, session);
    await audit(
      ctx,
      { action: `postsales.${input.kind}_create`, entityType: "booking", entityId: booking._id, summary: `${number} (${status})` },
      session
    );
    return doc.toJSON();
  });
}
var NEXT_STATUS = {
  agreement: { draft: ["executed", "cancelled"], executed: ["registered", "cancelled"], registered: ["cancelled"] },
  registry: { scheduled: ["registered", "cancelled"] },
  possession: { offered: ["handed_over", "cancelled"] },
  demand: { issued: ["cancelled"] }
};
async function updateSalesDocument(ctx, id, input) {
  return withTransaction(async (session) => {
    const doc = await SalesDocument.findOne({ companyId: ctx.companyId, _id: toObjectId(id) }).session(session).lean();
    if (!doc) throw notFound("Document");
    assertProjectAccess(ctx, doc.projectId);
    const kind = doc.kind;
    if (doc.status === "cancelled") throw businessRule("This document has been cancelled");
    const set = {};
    if (input.details) {
      if (kind === "demand") throw businessRule("Demand letters cannot be edited; cancel and issue a new one");
      const allowed = {
        agreement: ["executedOn", "stampDutyPaise", "registrationFeePaise", "registrationNumber", "witnesses", "terms"],
        registry: [
          "scheduledOn",
          "registeredOn",
          "deedNumber",
          "subRegistrarOffice",
          "stampDutyPaise",
          "registrationFeePaise",
          "consultantId"
        ],
        possession: ["offeredOn", "handedOverOn", "possessionType", "keysHandedTo"]
      };
      const merged = { ...doc.details };
      for (const [k, v] of Object.entries(input.details)) {
        if (!allowed[kind].includes(k)) throw badRequest(`Unknown field ${k}`);
        if (k.endsWith("Paise") && v !== null && v !== void 0 && (!Number.isSafeInteger(v) || v < 0))
          throw badRequest(`${k} must be whole paise`);
        if (k.endsWith("On") && v && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw badRequest(`${k} must be a date`);
        if (k === "consultantId" && v && !await Consultant.exists({ companyId: ctx.companyId, _id: toObjectId(String(v)) }).session(session))
          throw badRequest("Consultant not found");
        if (v === null || v === "") delete merged[k];
        else merged[k] = typeof v === "string" ? v.slice(0, 1e4) : v;
      }
      set.details = merged;
      set.amountPaise = Number(merged.stampDutyPaise ?? 0) + Number(merged.registrationFeePaise ?? 0);
    }
    if (input.remarks !== void 0) set.remarks = input.remarks;
    const details = set.details ?? doc.details;
    let to;
    if (input.status && input.status !== doc.status) {
      to = input.status;
      if (!NEXT_STATUS[kind][doc.status]?.includes(to))
        throw businessRule(`A ${doc.status.replace("_", " ")} ${kind} cannot be marked ${to.replace("_", " ")}`);
      if (kind === "registry" && to === "registered") {
        if (!details.deedNumber || !details.registeredOn) throw badRequest("Enter the deed number and registration date first");
        await duesGuard(
          ctx,
          "registry",
          doc.bookingId,
          input.overrideDues || !!doc.duesOverridden,
          input.remarks ?? doc.remarks ?? void 0,
          session
        );
      }
      if (kind === "possession" && to === "handed_over") {
        if (!details.handedOverOn) details.handedOverOn = todayInIndia();
        set.details = details;
        await duesGuard(
          ctx,
          "possession",
          doc.bookingId,
          input.overrideDues || !!doc.duesOverridden,
          input.remarks ?? doc.remarks ?? void 0,
          session
        );
      }
      if (kind === "agreement" && to === "executed" && !details.executedOn) {
        details.executedOn = todayInIndia();
        set.details = details;
      }
      set.status = to;
    }
    const res = await SalesDocument.updateOne(
      { companyId: ctx.companyId, _id: doc._id, status: doc.status },
      { $set: set, ...to ? { $push: { history: { status: to, note: input.remarks, by: ctx.userId } } } : {} },
      { session }
    );
    if (res.modifiedCount !== 1 && Object.keys(set).length) throw businessRule("The document changed concurrently, please retry");
    if (kind === "registry" && to === "registered") {
      const booking = await loadBooking(ctx, doc.bookingId, session);
      await markUnitsSold(ctx, booking, session);
    }
    await audit(
      ctx,
      {
        action: `postsales.${kind}_update`,
        entityType: "booking",
        entityId: doc.bookingId,
        summary: doc.number,
        changes: { ...input, details: void 0 }
      },
      session
    );
    return { id: String(doc._id), status: to ?? doc.status };
  });
}
async function bulkDemand(ctx, input) {
  assertProjectAccess(ctx, input.projectId);
  const settings = await companySettings(ctx);
  const dueUpTo = input.dueUpTo ?? addDays(input.date, settings?.demandLeadDays ?? 15);
  const candidates = await Installment.aggregate([
    {
      $match: {
        companyId: ctx.companyId,
        projectId: toObjectId(input.projectId),
        status: { $in: ["pending", "partial"] },
        dueDate: { $lte: day2(dueUpTo) }
      }
    },
    { $group: { _id: "$bookingId", bal: { $sum: { $subtract: ["$amountPaise", "$paidPaise"] } } } },
    { $match: { bal: { $gt: 0 } } }
  ]);
  const already = new Set(
    (await SalesDocument.find({
      companyId: ctx.companyId,
      kind: "demand",
      status: "issued",
      date: day2(input.date),
      bookingId: { $in: candidates.map((c) => c._id) }
    }).select("bookingId").lean()).map((d) => String(d.bookingId))
  );
  let created2 = 0;
  let skipped = 0;
  for (const c of candidates) {
    if (already.has(String(c._id))) {
      skipped++;
      continue;
    }
    try {
      await createSalesDocument(ctx, { kind: "demand", bookingId: String(c._id), date: input.date, dueUpTo, payBy: input.payBy });
      created2++;
    } catch {
      skipped++;
    }
  }
  return { created: created2, skipped };
}
async function listSalesDocuments(ctx, q) {
  const filter = { ...scopedFilter(ctx, q.projectId), kind: q.kind };
  if (q.status) filter.status = q.status;
  if (q.bookingId) filter.bookingId = toObjectId(q.bookingId);
  if (q.q) filter.number = new RegExp(escapeRegex(q.q), "i");
  const sort = parseSort(q.sort, ["date", "number", "amountPaise", "status"], { date: -1, createdAt: -1 });
  const [items, total, counts] = await Promise.all([
    SalesDocument.find(filter).sort(sort).skip((q.page - 1) * q.pageSize).limit(q.pageSize).select("-history").populate({ path: "bookingId", select: "bookingNumber status", match: { companyId: ctx.companyId } }).populate({ path: "customerId", select: "name phone", match: { companyId: ctx.companyId } }).populate({ path: "projectId", select: "name code", match: { companyId: ctx.companyId } }).lean(),
    SalesDocument.countDocuments(filter),
    SalesDocument.aggregate([
      { $match: { ...scopedFilter(ctx, q.projectId), kind: q.kind } },
      { $group: { _id: "$status", n: { $sum: 1 } } }
    ])
  ]);
  return { items, meta: pageMeta(q.page, q.pageSize, total), summary: Object.fromEntries(counts.map((c) => [c._id, c.n])) };
}
async function getSalesDocument(ctx, id) {
  const doc = await SalesDocument.findOne({ ...scopedFilter(ctx), _id: toObjectId(id) }).populate({
    path: "bookingId",
    select: "bookingNumber status bookingDate netAmountPaise receivedPaise",
    match: { companyId: ctx.companyId }
  }).populate({ path: "customerId", select: "name phone email address coApplicants pan", match: { companyId: ctx.companyId } }).populate({ path: "projectId", select: "name code reraNumber address", match: { companyId: ctx.companyId } }).populate("history.by", "name").lean();
  if (!doc) throw notFound("Document");
  const details = doc.details;
  const consultant = details?.consultantId ? await Consultant.findOne({ companyId: ctx.companyId, _id: details.consultantId }).select("name firm phone").lean() : null;
  const items = await BookingItem.find({
    companyId: ctx.companyId,
    bookingId: doc.bookingId?._id ?? doc.bookingId,
    active: true
  }).lean();
  return { ...doc, consultant, units: items };
}
var rs3 = (paise2) => `Rs. ${formatINR(paise2, { symbol: false })}`;
var TITLES = {
  agreement: "AGREEMENT FOR SALE (BUILDER-BUYER AGREEMENT)",
  registry: "SALE DEED REGISTRATION MEMO",
  possession: "POSSESSION LETTER",
  demand: "PAYMENT DEMAND LETTER"
};
var DEFAULT_TERMS = [
  "The Allottee shall pay the total consideration as per the payment schedule annexed hereto. Delay in payment shall attract interest as per the applicable RERA rules.",
  "The Promoter shall hand over possession of the unit on or before the date committed, subject to force majeure and timely payment by the Allottee.",
  "Stamp duty, registration charges, GST and other statutory levies, as applicable, shall be borne by the Allottee.",
  "The Allottee shall not transfer or assign this agreement without the prior written consent of the Promoter.",
  "Cancellation by the Allottee shall be governed by the cancellation policy of the Promoter and applicable law.",
  "This agreement is subject to the jurisdiction of the courts where the project is situated."
];
async function salesDocumentPdf(ctx, id, res) {
  const d = await getSalesDocument(ctx, id);
  const company = await Company.findById(ctx.companyId).lean();
  const bank = await Account.findOne({
    companyId: ctx.companyId,
    isActive: true,
    "bankDetails.accountNumber": { $exists: true, $ne: null }
  }).sort({ "bankDetails.isReraAccount": -1, code: 1 }).lean();
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${d.number.replace(/[^\w.-]/g, "_")}.pdf"`);
  res.setHeader("Cache-Control", "private, no-store");
  const doc = new PDFDocument3({ size: "A4", margin: 50 });
  doc.pipe(res);
  const companyName = company?.legalName || company?.name || "";
  doc.fontSize(16).font("Helvetica-Bold").text(companyName);
  doc.fontSize(9).font("Helvetica").fillColor("#555");
  const addr = [company?.address?.line1, company?.address?.city, company?.address?.state, company?.address?.pincode].filter(Boolean).join(", ");
  if (addr) doc.text(addr);
  if (company?.gstin) doc.text(`GSTIN: ${company.gstin}`);
  doc.moveDown(0.8).fillColor("#000").fontSize(13).font("Helvetica-Bold").text(TITLES[d.kind], { align: "center" });
  if (d.status === "cancelled") doc.fillColor("#b91c1c").fontSize(11).text("CANCELLED", { align: "center" }).fillColor("#000");
  doc.moveDown(0.6).fontSize(10).font("Helvetica");
  const row2 = (label, value) => {
    const y = doc.y;
    doc.font("Helvetica-Bold").text(label, 50, y, { width: 170 });
    doc.font("Helvetica").text(value, 220, y, { width: 325 });
    doc.moveDown(0.3);
  };
  const units = d.units.map((u) => `${u.blockCode ? `${u.blockCode}-` : ""}${u.plotNumber} (${areaToSqft(u.areaX100)} sq ft)`).join(", ");
  const cust = d.customerId;
  const custAddr = [cust?.address?.line1, cust?.address?.city, cust?.address?.state].filter(Boolean).join(", ");
  row2("Reference", d.number);
  row2("Date", formatDate(iso(d.date)));
  row2("Booking", d.bookingId?.bookingNumber ?? "");
  row2(
    d.kind === "agreement" ? "Allottee" : "Customer",
    `${cust?.name ?? ""}${cust?.coApplicants?.length ? ` & ${cust.coApplicants.map((c) => c.name).join(", ")}` : ""}`
  );
  if (custAddr) row2("Address", custAddr);
  row2("Project", `${d.projectId?.name ?? ""}${d.projectId?.reraNumber ? ` (RERA: ${d.projectId.reraNumber})` : ""}`);
  row2("Unit(s)", units);
  const det = d.details ?? {};
  if (d.kind === "agreement") {
    row2("Total consideration", rs3(d.bookingId?.netAmountPaise ?? 0));
    if (det.executedOn) row2("Executed on", formatDate(String(det.executedOn)));
    if (det.registrationNumber) row2("Registration No.", String(det.registrationNumber));
    if (det.stampDutyPaise) row2("Stamp duty", rs3(Number(det.stampDutyPaise)));
    if (det.registrationFeePaise) row2("Registration fee", rs3(Number(det.registrationFeePaise)));
    doc.moveDown(0.6).font("Helvetica-Bold").text("Parties").font("Helvetica");
    doc.text(
      `This Agreement is made between ${companyName} ("the Promoter") and ${cust?.name ?? ""} ("the Allottee") for the unit(s) described above in ${d.projectId?.name ?? ""}.`
    );
    doc.moveDown(0.6).font("Helvetica-Bold").text("Terms").font("Helvetica");
    const terms = typeof det.terms === "string" && det.terms.trim() ? det.terms.split(/\n+/) : DEFAULT_TERMS;
    terms.forEach((t, i) => doc.text(`${i + 1}. ${t.trim()}`).moveDown(0.2));
    if (det.witnesses) doc.moveDown(0.4).text(`Witnesses: ${String(det.witnesses)}`);
    doc.moveDown(2.5);
    const y = doc.y;
    doc.text("For the Promoter", 50, y).text("Allottee", 400, y);
  } else if (d.kind === "registry") {
    if (det.scheduledOn) row2("Scheduled on", formatDate(String(det.scheduledOn)));
    if (det.registeredOn) row2("Registered on", formatDate(String(det.registeredOn)));
    if (det.deedNumber) row2("Deed number", String(det.deedNumber));
    if (det.subRegistrarOffice) row2("Sub-registrar office", String(det.subRegistrarOffice));
    if (det.stampDutyPaise) row2("Stamp duty", rs3(Number(det.stampDutyPaise)));
    if (det.registrationFeePaise) row2("Registration fee", rs3(Number(det.registrationFeePaise)));
    if (d.consultant) row2("Registry consultant", `${d.consultant.name}${d.consultant.firm ? `, ${d.consultant.firm}` : ""}`);
    row2("Status", d.status.replace("_", " ").toUpperCase());
    doc.moveDown(1).text(
      d.status === "registered" ? `The sale deed for the above unit(s) has been registered in favour of ${cust?.name ?? ""}. Ownership stands transferred as per the registered deed.` : `The sale deed registration for the above unit(s) is scheduled as stated. The purchaser is requested to be present with original identity documents and two passport-size photographs.`
    );
  } else if (d.kind === "possession") {
    doc.moveDown(0.6).text(`Dear ${cust?.name ?? "Customer"},`).moveDown(0.5);
    doc.text(
      d.status === "handed_over" ? `We are pleased to confirm that ${det.possessionType === "paper" ? "paper" : "physical"} possession of the above unit(s) was handed over to you on ${formatDate(String(det.handedOverOn ?? iso(d.date)))}${det.keysHandedTo ? ` (received by ${String(det.keysHandedTo)})` : ""}. From this date, maintenance and statutory charges for the unit(s) are payable by you.` : `We are pleased to offer you possession of the above unit(s)${det.offeredOn ? ` from ${formatDate(String(det.offeredOn))}` : ""}. Kindly contact our office to schedule the handover after clearing any outstanding dues and completing the documentation.`
    );
    doc.moveDown(2).text(`For ${companyName}`).moveDown(2).text("Authorised Signatory");
  } else {
    const lines = det.lines ?? [];
    doc.moveDown(0.4).text(`Dear ${cust?.name ?? "Customer"},`).moveDown(0.3);
    doc.text(
      `The following installment(s) on your booking are due. Kindly pay ${rs3(d.amountPaise)} on or before ${formatDate(String(det.payBy))}.`
    ).moveDown(0.5);
    const top = doc.y;
    const cols = [50, 230, 320, 410, 480];
    doc.font("Helvetica-Bold");
    ["Installment", "Due date", "Amount", "Paid", "Balance"].forEach((h, i) => doc.text(h, cols[i], top, { width: i === 0 ? 175 : 85 }));
    doc.font("Helvetica");
    let y = top + 16;
    for (const l of lines) {
      doc.text(l.name, cols[0], y, { width: 175 });
      doc.text(formatDate(l.dueDate), cols[1], y);
      doc.text(formatINR(l.amountPaise, { symbol: false }), cols[2], y);
      doc.text(formatINR(l.paidPaise, { symbol: false }), cols[3], y);
      doc.text(formatINR(l.balancePaise, { symbol: false }), cols[4], y);
      y += 16;
    }
    doc.font("Helvetica-Bold").text(`Total due: ${rs3(d.amountPaise)}`, 50, y + 6);
    doc.font("Helvetica").moveDown(0.8);
    if (Number(det.lateInterestBpPerMonth) > 0) {
      doc.text(
        `Delayed payments attract interest at ${(Number(det.lateInterestBpPerMonth) / 100).toFixed(2)}% per month as per the agreement.`,
        50
      );
    }
    if (bank?.bankDetails?.accountNumber) {
      doc.moveDown(0.6).font("Helvetica-Bold").text("Payment details", 50).font("Helvetica");
      doc.text(`Account name: ${companyName}`);
      doc.text(`Bank: ${bank.bankDetails.bankName ?? ""}${bank.bankDetails.branch ? `, ${bank.bankDetails.branch}` : ""}`);
      doc.text(`A/c No.: ${bank.bankDetails.accountNumber}   IFSC: ${bank.bankDetails.ifsc ?? ""}`);
    }
    doc.moveDown(1.5).text("Please ignore this letter if the payment has already been made.").moveDown(1.5).text(`For ${companyName}`).moveDown(2).text("Authorised Signatory");
  }
  if (d.remarks && d.kind !== "agreement") doc.moveDown(1).fontSize(9).fillColor("#555").text(`Remarks: ${d.remarks}`, 50);
  doc.end();
}

// src/modules/postsales/postsales.routes.ts
var postSalesRouter = Router16();
postSalesRouter.put(
  "/bookings/:id/loan",
  authorize("postSales.update"),
  validate({ params: idParam, body: bookingLoanSchema.nullable() }),
  async (req, res) => ok(res, await setBookingLoan(getCtx(req), params(req).id, body(req)))
);
postSalesRouter.get("/allotments", authorize("postSales.read"), validate({ query: allotmentQuerySchema }), async (req, res) => {
  const { items, meta: meta2 } = await listAllotments(getCtx(req), query(req));
  ok(res, items, meta2);
});
postSalesRouter.get(
  "/allotments/summary",
  authorize("postSales.read"),
  validate({ query: allotmentQuerySchema }),
  async (req, res) => ok(res, (await listAllotments(getCtx(req), { ...query(req), page: 1, pageSize: 1 })).summary)
);
postSalesRouter.post(
  "/bookings/:id/allotment",
  authorize("postSales.update"),
  validate({ params: idParam, body: z23.object({ issued: z23.boolean(), via: trimmed(40).optional() }) }),
  async (req, res) => {
    const b = body(req);
    ok(res, await markAllotmentIssued(getCtx(req), params(req).id, b.issued, b.via));
  }
);
postSalesRouter.get("/cancellations", authorize("bookings.read"), validate({ query: cancellationsQuerySchema }), async (req, res) => {
  const { items, meta: meta2 } = await listCancellations(getCtx(req), query(req));
  ok(res, items, meta2);
});
postSalesRouter.get(
  "/cancellations/summary",
  authorize("bookings.read"),
  validate({ query: cancellationsQuerySchema }),
  async (req, res) => ok(res, (await listCancellations(getCtx(req), { ...query(req), page: 1, pageSize: 1 })).summary)
);
postSalesRouter.get("/dues", authorize("collections.read"), validate({ query: duesQuerySchema }), async (req, res) => {
  const { items, meta: meta2 } = await listDues(getCtx(req), query(req));
  ok(res, items, meta2);
});
postSalesRouter.get(
  "/dues/summary",
  authorize("collections.read"),
  validate({ query: duesQuerySchema }),
  async (req, res) => ok(res, (await listDues(getCtx(req), { ...query(req), page: 1, pageSize: 1 })).summary)
);
postSalesRouter.get(
  "/follow-ups",
  authorize("collections.read"),
  validate({ query: z23.object({ bookingId: objectId }) }),
  async (req, res) => ok(res, await listFollowUps(getCtx(req), query(req).bookingId))
);
postSalesRouter.post(
  "/follow-ups",
  authorize("collections.create"),
  validate({ body: followUpSchema }),
  async (req, res) => created(res, await createFollowUp(getCtx(req), body(req)))
);
postSalesRouter.get("/documents", authorize("postSales.read"), validate({ query: salesDocListQuerySchema }), async (req, res) => {
  const { items, meta: meta2 } = await listSalesDocuments(getCtx(req), query(req));
  ok(res, items, meta2);
});
postSalesRouter.get(
  "/documents/summary",
  authorize("postSales.read"),
  validate({ query: salesDocListQuerySchema }),
  async (req, res) => ok(res, (await listSalesDocuments(getCtx(req), { ...query(req), page: 1, pageSize: 1 })).summary)
);
postSalesRouter.post(
  "/documents",
  authorize("postSales.create"),
  validate({ body: salesDocCreateSchema }),
  async (req, res) => created(res, await createSalesDocument(getCtx(req), body(req)))
);
postSalesRouter.post(
  "/documents/demand/bulk",
  authorize("postSales.create"),
  validate({ body: demandBulkSchema }),
  async (req, res) => ok(res, await bulkDemand(getCtx(req), body(req)))
);
postSalesRouter.get(
  "/documents/:id",
  authorize("postSales.read"),
  validate({ params: idParam }),
  async (req, res) => ok(res, await getSalesDocument(getCtx(req), params(req).id))
);
postSalesRouter.patch(
  "/documents/:id",
  authorize("postSales.update"),
  validate({ params: idParam, body: salesDocUpdateSchema }),
  async (req, res) => ok(res, await updateSalesDocument(getCtx(req), params(req).id, body(req)))
);
postSalesRouter.get("/documents/:id/pdf", authorize("postSales.read"), validate({ params: idParam }), async (req, res) => {
  await salesDocumentPdf(getCtx(req), params(req).id, res);
});

// src/app.ts
function createApp() {
  const app2 = express2();
  app2.disable("x-powered-by");
  app2.set("trust proxy", env.TRUST_PROXY || (process.env.VERCEL ? 1 : 0));
  app2.use(requestId);
  app2.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      autoLogging: { ignore: (req) => req.url === "/api/health" }
    })
  );
  app2.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: "same-site" }
    })
  );
  app2.use(
    cors2({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (env.corsOrigins.includes(origin)) return cb(null, true);
        if (origin.endsWith(".vercel.app")) return cb(null, true);
        if (process.env.VERCEL_URL && origin.includes(process.env.VERCEL_URL)) return cb(null, true);
        return cb(null, false);
      },
      credentials: true,
      exposedHeaders: ["x-request-id", "idempotent-replayed", "content-disposition", "x-total-amount"]
    })
  );
  app2.use(express2.json({ limit: "1mb" }));
  app2.use(cookieParser());
  app2.get("/api/health", async (_req, res) => {
    const dbUp = mongoose4.connection.readyState === 1;
    res.status(dbUp ? 200 : 503).json({ success: dbUp, data: { status: dbUp ? "ok" : "degraded", db: dbUp } });
  });
  const v1 = Router17();
  v1.use(apiLimiter);
  v1.use("/auth", authRouter);
  v1.use("/files", filesRouter);
  v1.use("/inbound/leads", inboundRouter);
  const tenantScoped = Router17();
  tenantScoped.use(authenticate, tenant);
  tenantScoped.use("/projects", projectsRouter);
  tenantScoped.use("/customers", customersRouter);
  tenantScoped.use("/brokers", brokersRouter);
  tenantScoped.use("/land", landRouter);
  tenantScoped.use("/leads", crmRouter);
  tenantScoped.use("/vendors", vendorsRouter);
  tenantScoped.use("/work-orders", workOrdersRouter);
  tenantScoped.use("/expenses", expensesRouter);
  tenantScoped.use("/documents", documentsRouter);
  tenantScoped.use("/payment-plans", plansRouter);
  tenantScoped.use("/bookings", bookingsRouter);
  tenantScoped.use("/payments", paymentsRouter);
  tenantScoped.use("/accounting", accountingRouter);
  tenantScoped.use("/structure", structureRouter);
  tenantScoped.use("/rate-indexes", rateIndexesRouter);
  tenantScoped.use("/parties", partiesRouter);
  tenantScoped.use("/financers", financersRouter);
  tenantScoped.use("/consultants", consultantsRouter);
  tenantScoped.use("/charges", chargesRouter);
  tenantScoped.use("/parking", parkingRouter);
  tenantScoped.use("/sales-dashboard", salesDashboardRouter);
  tenantScoped.use("/lead-settings", leadSettingsRouter);
  tenantScoped.use("/whatsapp-templates", whatsappTemplatesRouter);
  tenantScoped.use("/integrations", integrationsRouter);
  tenantScoped.use("/quotations", quotationsRouter);
  tenantScoped.use("/post-sales", postSalesRouter);
  tenantScoped.use("/cash-bank-accounts", cashBankRouter);
  tenantScoped.use("/pdcs", pdcRouter);
  tenantScoped.use("/vendor-payments", vendorPaymentsRouter);
  tenantScoped.use("/ledger-adjustments", adjustmentsRouter);
  tenantScoped.use("/gst-vouchers", gstRouter);
  tenantScoped.use("/", reportsRouter);
  tenantScoped.use("/", adminRouter);
  v1.use(tenantScoped);
  app2.use("/api/v1", v1);
  app2.use(notFoundHandler);
  app2.use(errorHandler);
  return app2;
}

// src/config/db.ts
import mongoose5 from "mongoose";
mongoose5.set("strictQuery", true);
mongoose5.set("autoIndex", true);
var isConnecting = null;
async function connectDb(uri = env.MONGODB_URI) {
  if (mongoose5.connection.readyState === 1) {
    return mongoose5;
  }
  if (isConnecting) {
    return isConnecting;
  }
  isConnecting = (async () => {
    const conn = await mongoose5.connect(uri, {
      serverSelectionTimeoutMS: 1e4,
      dbName: "real_estate_erp"
    });
    await assertTransactionsSupported();
    logger.info({ db: conn.connection.name }, "MongoDB connected");
    return conn;
  })().finally(() => {
    isConnecting = null;
  });
  return isConnecting;
}
async function assertTransactionsSupported() {
  try {
    const db = mongoose5.connection.db;
    if (!db) return;
    let hello;
    try {
      hello = await db.command({ hello: 1 });
    } catch {
      hello = await db.admin().command({ hello: 1 });
    }
    if (hello && !hello.setName && hello.msg !== "isdbgrid") {
      logger.warn("MongoDB does not report replica set setName; multi-document transactions may not work.");
    }
  } catch (err) {
    logger.warn({ err }, "Could not assert replica set support, proceeding anyway");
  }
}

// src/serverless.ts
try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch {
}
var app = createApp();
var connectPromise = null;
async function ensureDb() {
  if (mongoose6.connection.readyState === 1) return;
  if (!connectPromise) {
    connectPromise = connectDb().catch((err) => {
      connectPromise = null;
      throw err;
    });
  }
  await connectPromise;
}
async function handler(req, res) {
  try {
    await ensureDb();
  } catch (err) {
    console.error("MongoDB serverless connection error:", err);
    return res.status(503).json({
      success: false,
      error: {
        code: "DATABASE_UNAVAILABLE",
        message: "Could not connect to MongoDB Atlas. Please verify MONGODB_URI in Vercel environment variables.",
        details: err?.message
      }
    });
  }
  if (req.url && !req.url.startsWith("/api")) {
    req.url = "/api" + (req.url.startsWith("/") ? req.url : "/" + req.url);
  }
  return app(req, res);
}
export {
  handler as default
};
