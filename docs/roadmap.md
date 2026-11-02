# Roadmap

## Phase 1: core (done)

Auth and sessions, tenancy and RBAC, projects and structure, plot inventory, interactive map with editor, customers, payment plans, quotations, reservations, bookings, receipts, reversals, refunds, double-entry accounting and reports, dashboard, notifications job, audit log, search, Excel and PDF output, tests, Docker and CI.

## Phase 2: operations modules (done)

1. **Land acquisition** (`landparcels`, `landpayments`): khasra/khata records, owners, agreed cost, negotiation → agreement → registry → conversion (or dropped) with history, mutation flag. Payments to owners post Dr Land & Development (WIP) · Cr Cash/Bank and can never exceed the agreed cost.
2. **Document management** (`documents`): private storage behind a driver (local disk with HMAC-signed links, or S3-compatible with presigned GETs). Uploads go through the API (multipart) with allow-listed types, a size cap and magic-byte checks; every view or download re-checks access and issues a link valid for 5 minutes. Deletes are soft. Attached to projects, land parcels, customers (KYC), bookings, leads, vendors and work orders.
3. **CRM** (`leads`, `leadactivities`): board and list views, sources, budget and interest, owner assignment, follow-up dates with an in-app reminder job, activity timeline that advances status, lost reasons, conversion to a customer (deduplicated by phone), and summary stats on the dashboard.
4. **Construction and vendors** (`vendors`, `workorders`, `expenses`, `vendorpayments`): work orders with milestones and status transitions, vendor bills against an order (Dr expense/WIP · Cr Vendor Payables) capped at the contract value, paid-now expenses, vendor payments capped at the payable balance, bill reversal (refused once paid), and a per-project cost summary.
5. **Broker commissions** (`brokercommissions`): accrue when a booking is confirmed (Dr Brokerage · Cr Broker Payables, on gross − discount), reverse when an unpaid booking is cancelled, settle with idempotent payouts.

Note: uploads go through the API rather than presigned PUTs, so the server can verify the file signature before anything is stored. Revisit if very large files are needed.

## Phase 3: builder/developer menu (done)

The application was reorganised into the five-section menu (Administration, Master, Pre Sales, Post Sales, Account) and every item is a working screen:

- **Administration:** Phases/Towers overview with unit status; Bank & Cash Accounts (bank details, RERA flag, opening balances, live balances); Rate & Price Indexes that reprice only unsold units (with a dry run); Settings for quotation validity, demand-letter lead days, late interest and dues rules for registry/possession.
- **Master:** land owners/partners/investors, home-loan lenders (with APF projects and loans per booking), registry & legal consultants, charge master (fixed / per sq ft / % of value, GST, mandatory), parking slots (bulk create, allot, release, auto-release on cancellation), unit types (plot, flat, villa, row house, shop, office, farm house) with tower and floor.
- **Pre Sales:** sales dashboard; configurable lead sources, stage labels and lost reasons; WhatsApp templates with variables, rendered for a lead/customer/booking and logged; inbound lead webhooks with field mapping, de-duplication of repeat enquiries, delivery logs and token rotation; saved quotations (numbered, PDF, expiry, one-time conversion into a booking).
- **Post Sales:** cancellations with refund status; agreements, sale-deed registry (marks units sold), possession and demand letters with PDFs and status history; dues aging with follow-up log and promises; allotment-letter tracking; booking-level home loans.
- **Account:** PDC register (deposit → clear creates the receipt exactly once; bounce/return); vendor payments across vendors; ledger adjustments (credit notes reduce the latest unpaid installments, debit notes add a charge; both reversible and unwound on cancellation); GST vouchers with a period summary.

## Next: enhancements

- Saved quotations with validity and conversion to booking
- Email, SMS and WhatsApp reminders (provider adapters) alongside in-app notifications
- GST on applicable charges and TDS on property purchases (Section 194-IA) in receipts and reports
- Cheque clearing workflow (received → deposited → cleared/bounced)
- Map background layer (uploaded layout image) using document storage
- Server-sent events for instant map updates (currently 15 s polling)
- Customer self-service portal (statement, receipts, dues)
- Fine-grained field-level audit diffs and configurable data-retention and archival policies
