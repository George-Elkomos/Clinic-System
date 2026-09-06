# Clinic Chart of Accounts — Target Design

**Purpose**
Specify a chart of accounts appropriate to a clinic, derived from the reference project's
structure but reshaped for healthcare revenue lines and multi-payer receivables. Includes the
named-account map that code resolves against.

**Scope**
The account tree, the `account_type` behavioural tags, the purpose→account map, and the
accounts that healthcare specifically requires and the reference project lacks.

**Audience**
The developer implementing Phase 2 of [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md), and the
accountant who must sign off the tree.

**Related documents**
- *../03-accounting/chart-of-accounts.md* — the reference model and every `account_type`
- [clinic-accounting-model.md](clinic-accounting-model.md)§4 — the Account entity
- [clinic-accounting-events.md](clinic-accounting-events.md) — which accounts each event touches

> **Layer 2 document.** **[Recommended]** marks design decisions. The reference project's
> structure is cited with evidence labels.

---

## 1. What is carried over from the reference project

**[Confirmed]** The reference project ships a template chart at
`standard_chart_of_accounts.py`
with five roots, using Indian-accounting terminology:

```
Application of Funds (Assets)          root_type: Asset
    Current Assets
        Accounts Receivable → Debtors        (account_type: Receivable)
        Bank Accounts                        (account_type: Bank, is_group)
        Cash In Hand → Cash                  (account_type: Cash)
        Loans and Advances (Assets) → Employee Advances
        Securities and Deposits → Earnest Money
        Stock Assets → Stock In Hand         (account_type: Stock)
        Tax Assets                           (is_group)
    Fixed Assets
        Capital Equipments, Electronic Equipments, Furnitures and Fixtures,
        Office Equipments, Plants and Machineries, Buildings, …
                                             (account_type: Fixed Asset)
Expenses                               root_type: Expense
Income                                 root_type: Income
Source of Funds (Liabilities)          root_type: Liability
Equity                                 root_type: Equity
```

**[Recommended] Carried over:**
- The **five-root structure** keyed on `root_type` — universal double-entry, not negotiable.
- The **`account_type` behavioural tag**. This is the reference project's quietly best idea:
  code asks for "the receivable account" by *type*, never by code or name. Keep it.
- **Group vs leaf** (`is_group`), with posting only to leaves.
- **Per-company (per-clinic) scoping** of the whole tree.

**[Recommended] Changed:**
- The Indian terminology (*"Application of Funds"*, *"Source of Funds"*) is replaced with
  standard IFRS-style naming. Cosmetic, but the tree is read by accountants and auditors.
- **Revenue is segmented by clinical service line** — the reference project ships a single
  generic `Sales`/`Service` income node, which makes departmental P&L impossible without
  dimensions.
- **Receivables are segmented by payer class.** The reference project has one `Debtors` node
  and achieves insurer segregation only by attaching a `Party Account` row to the insurer's
  Customer (*../04-modules/healthcare-insurance.md*§2.1).
  Making it structural is clearer.
- Several **healthcare-specific accounts are added** that the reference project has no
  equivalent for (§4).

---

## 2. The recommended tree

**[Recommended]** Codes shown are a 4-digit convention; adapt to local practice. `[type]` is
the `account_type` tag. Leaf accounts are postable; everything else is a group.

```
1000  ASSETS                                                    root_type: ASSET
  1100  Current Assets
    1110  Cash & Cash Equivalents
      1111  Cash on Hand — Main Till                            [CASH]
      1112  Cash on Hand — Branch Tills                         [CASH]
      1113  Petty Cash                                          [CASH]
      1114  Undeposited Receipts (in transit)                   [CASH]
      1120  Bank Accounts                                       (group) [BANK]
        1121  Bank — Operating Account                          [BANK]
        1122  Bank — Payer Settlement Account                   [BANK]
      1130  Payment Gateway Clearing                            [BANK]
            └─ money authorised but not yet settled to bank

    1200  Accounts Receivable                                   (group)
      1210  AR — Patients (self-pay)                            [RECEIVABLE]
      1220  AR — Insurers                                       (group)
        1221  AR — Insurer: <per insurer, or one control>       [RECEIVABLE]
      1230  AR — Corporate Accounts                             [RECEIVABLE]
      1240  AR — Unbilled Charges (accrued revenue)             [RECEIVABLE]
            └─ optional; see §5 on accrual timing
      1250  AR — Claims Submitted, Not Adjudicated              [RECEIVABLE]
            └─ optional sub-analysis of 1220

    1300  Inventory
      1310  Pharmacy Inventory                                  [INVENTORY]
      1320  Medical Consumables Inventory                       [INVENTORY]
      1330  Laboratory Reagents Inventory                       [INVENTORY]
      1340  Inventory Received Not Billed                       [INVENTORY]

    1400  Prepayments & Other Current Assets
      1410  Prepaid Expenses
      1420  Staff Advances
      1430  Supplier Advances
      1440  Recoverable Taxes                                   [TAX]

  1500  Non-Current Assets
    1510  Medical Equipment                                     [FIXED_ASSET]
    1511    Accumulated Depreciation — Medical Equipment        [ACCUMULATED_DEPRECIATION]
    1520  Furniture & Fixtures                                  [FIXED_ASSET]
    1521    Accumulated Depreciation — Furniture                [ACCUMULATED_DEPRECIATION]
    1530  IT & Office Equipment                                 [FIXED_ASSET]
    1531    Accumulated Depreciation — IT Equipment             [ACCUMULATED_DEPRECIATION]
    1540  Leasehold Improvements                                [FIXED_ASSET]
    1541    Accumulated Depreciation — Leasehold                [ACCUMULATED_DEPRECIATION]
    1550  Buildings                                             [FIXED_ASSET]
    1560  Capital Work in Progress                              [FIXED_ASSET]
    1570  Intangible Assets (software, licences)                [FIXED_ASSET]

2000  LIABILITIES                                               root_type: LIABILITY
  2100  Current Liabilities
    2110  Accounts Payable — Suppliers                          [PAYABLE]
    2120  Accounts Payable — Practitioners (fee-for-service)     [PAYABLE]
    2130  Accrued Expenses
    2140  Payroll Liabilities
      2141  Salaries Payable                                    [PAYABLE]
      2142  Statutory Deductions Payable                        [PAYABLE]
      2143  End-of-Service / Gratuity Provision                 [PAYABLE]
    2150  Tax Liabilities
      2151  VAT / Sales Tax Payable                             [TAX]
      2152  Withholding Tax Payable                             [TAX]

    2200  Patient & Payer Liabilities            ◄── clinic-specific
      2210  Patient Deposits Held                               [PATIENT_DEPOSIT]
            └─ money taken before treatment; NOT revenue
      2220  Patient Credit Balances (overpayments)              [PATIENT_DEPOSIT]
      2230  Payer Overpayments / Refunds Due                    [PATIENT_DEPOSIT]
      2240  Unearned Revenue — Prepaid Packages                 [DEFERRED_REVENUE]
      2250  Unearned Revenue — Memberships                      [DEFERRED_REVENUE]

  2500  Non-Current Liabilities
    2510  Long-Term Loans                                       [PAYABLE]
    2520  Lease Liabilities                                     [PAYABLE]

3000  EQUITY                                                    root_type: EQUITY
  3100  Share Capital / Owner's Capital                         [EQUITY]
  3200  Retained Earnings                                       [EQUITY]
        └─ the year-end closing target
  3300  Current Year Earnings                                   [EQUITY]
  3400  Drawings / Distributions                                [EQUITY]

4000  REVENUE                                                   root_type: INCOME
  4100  Clinical Service Revenue — GROSS          ◄── always gross; contra below
    4110  Consultation Revenue
      4111  Outpatient Consultation                             [INCOME]
      4112  Follow-up Consultation                              [INCOME]
      4113  Telemedicine Consultation                           [INCOME]
      4114  Inpatient Visit                                     [INCOME]
      4115  Emergency Consultation                              [INCOME]
    4120  Diagnostic Revenue
      4121  Laboratory                                          [INCOME]
      4122  Radiology / Imaging                                 [INCOME]
      4123  Cardiology Diagnostics                              [INCOME]
      4124  Other Diagnostics                                   [INCOME]
    4130  Procedure Revenue
      4131  Minor Procedures                                    [INCOME]
      4132  Major Procedures / Surgery                          [INCOME]
      4133  Day-Case Procedures                                 [INCOME]
    4140  Therapy & Rehabilitation Revenue                      [INCOME]
    4150  Inpatient Revenue
      4151  Room & Bed Charges                                  [INCOME]
      4152  Nursing Charges                                     [INCOME]
      4153  ICU / Critical Care                                 [INCOME]
    4160  Pharmacy Revenue                                      [INCOME]
    4170  Medical Consumables Revenue                           [INCOME]
    4180  Other Clinical Revenue                                [INCOME]

  4500  CONTRA-REVENUE (all debit-normal)      ◄── clinic-critical; see §4
    4510  Contractual Adjustments — Insurers                    [CONTRACTUAL_ADJUSTMENT]
    4520  Contractual Adjustments — Corporate                   [CONTRACTUAL_ADJUSTMENT]
    4530  Discounts — Policy (staff, charity, hardship)         [INCOME]
    4540  Discounts — Promotional                               [INCOME]
    4550  Entitlement / Free Follow-up Value Forgone            [INCOME]
    4560  Claim Denials Written Off                             [INCOME]
    4570  Bad Debt — Patient                                    (see 5400)
    4580  Refunds & Returns                                     [INCOME]

  4900  Non-Clinical Revenue
    4910  Rental / Concession Income                            [INCOME]
    4920  Medical Records / Certificate Fees                    [INCOME]
    4930  Registration Fees                                     [INCOME]
    4940  No-Show / Late-Cancellation Fees                      [INCOME]
    4950  Interest Income                                       [INCOME]
    4960  Foreign Exchange Gain                                 [INCOME]

5000  EXPENSES                                                  root_type: EXPENSE
  5100  Cost of Services
    5110  Pharmacy Cost of Goods Sold                           [COGS]
    5120  Medical Consumables Consumed                          [COGS]
    5130  Laboratory Reagents Consumed                          [COGS]
    5140  Outsourced Diagnostics                                [EXPENSE]
    5150  Practitioner Fees (fee-for-service)                   [EXPENSE]
    5160  Referral Fees                                         [EXPENSE]

  5200  Personnel Costs
    5210  Clinical Salaries          5220  Non-Clinical Salaries
    5230  Benefits & Allowances      5240  Statutory Contributions
    5250  Training & CME             5260  Gratuity / EOS Expense

  5300  Facility & Operating Costs
    5310  Rent / Lease               5320  Utilities
    5330  Cleaning & Housekeeping    5340  Equipment Maintenance
    5350  Medical Waste Disposal     5360  Insurance (property, liability, malpractice)
    5370  Licences & Accreditation

  5400  Administrative Costs
    5410  IT & Software Subscriptions   5420  Professional Fees (legal, audit)
    5430  Marketing & Patient Outreach  5440  Office Supplies
    5450  Telephone & Internet          5460  Travel
    5470  Bank & Payment Gateway Charges
    5480  Bad Debt Expense — Patient                            [WRITE_OFF]
    5490  Bad Debt Expense — Payer                              [WRITE_OFF]

  5500  Depreciation & Amortisation
    5510  Depreciation — Medical Equipment                      [EXPENSE]
    5520  Depreciation — Other                                  [EXPENSE]
    5530  Amortisation — Intangibles                            [EXPENSE]

  5600  Financial & Other
    5610  Interest Expense            5620  Foreign Exchange Loss
    5630  Inventory Write-off / Expiry [EXPENSE]
    5640  Cash Variance (till over/short)                       [EXPENSE]
    5690  Rounding Differences                                  [ROUND_OFF]
```

---

## 3. The named-account map

**[Recommended]** Code must never reference an account by code or name. It asks the map. This
generalises the reference project's Company default-account fields
(*../03-accounting/chart-of-accounts.md*) and its
`Party Account` per-entity overrides, both of which are good ideas.

```
ClinicAccountMap  (one row per clinic, validated for completeness at setup)

  PURPOSE                                → ACCOUNT
  ──────────────────────────────────────────────────────────────────────
  AR_PATIENT                             → 1210
  AR_INSURER                             → 1220/1221   (may be per-insurer)
  AR_CORPORATE                           → 1230
  PATIENT_DEPOSIT_LIABILITY              → 2210
  PATIENT_CREDIT_BALANCE                 → 2220
  DEFERRED_REVENUE_PACKAGE               → 2240
  CASH_DEFAULT                           → 1111
  CASH_BY_TILL[till_id]                  → 1111 / 1112
  BANK_DEFAULT                           → 1121
  GATEWAY_CLEARING[gateway]              → 1130
  REVENUE_BY_SERVICE_CATEGORY[cat]       → 4111 … 4180
  CONTRACTUAL_ADJUSTMENT[payer_type]     → 4510 / 4520
  DISCOUNT_POLICY[policy]                → 4530 / 4540
  ENTITLEMENT_FORGONE                    → 4550
  DENIAL_WRITE_OFF                       → 4560
  REFUND_CONTRA                          → 4580
  BAD_DEBT_PATIENT                       → 5480
  BAD_DEBT_PAYER                         → 5490
  TAX_PAYABLE[tax_group]                 → 2151
  COGS_BY_CATEGORY[cat]                  → 5110 / 5120 / 5130
  INVENTORY_BY_CATEGORY[cat]             → 1310 / 1320 / 1330
  AP_SUPPLIER                            → 2110
  AP_PRACTITIONER                        → 2120
  CASH_VARIANCE                          → 5640
  ROUNDING                               → 5690
  FX_GAIN / FX_LOSS                      → 4960 / 5620
  RETAINED_EARNINGS                      → 3200
  YEAR_END_CLOSING_TARGET                → 3200
```

**[Recommended]** Three rules:

1. **Completeness is validated at clinic setup**, not at first posting. **[Confirmed]** the
   reference project's cascades return an empty account and fail deep inside
   `make_gl_entries` (*../04-modules/healthcare-configuration.md*§3).
   The validator must also run as a health check, because adding a service category can create a
   new gap.
2. **`resolve(purpose, …)` raises**, never returns null.
3. **Revenue is resolved by service category, not by practitioner.** **[Confirmed]** the
   reference project routes revenue to a *different income account per practitioner* via
   `Party Account` rows, which is its only mechanism for per-doctor revenue
   (*../04-modules/healthcare-configuration.md*§3).
   That pollutes the chart with one account per doctor and breaks as staff change. **Use the
   `practitioner_id` dimension on the journal line instead** — same reporting, stable chart.

---

## 4. Accounts healthcare needs that the reference project lacks

**[Confirmed]** each of these is **[Not Found]** in the reference project. Each exists because
a specific healthcare event needs somewhere to go.

| Account | Why a clinic needs it | Reference project |
|---|---|---|
| **4510/4520 Contractual Adjustments** | The difference between list price and the payer-contracted price. Routine in healthcare, on nearly every insured line. Without it, gross revenue is overstated and the "collection rate" KPI is meaningless. | **[Not Found]** — no such concept anywhere |
| **2210 Patient Deposits Held** | Money taken before treatment is a **liability**, not revenue. Booking it as revenue overstates income and understates obligations. | **[Not Found]** — generic advances exist but are not wired to healthcare |
| **4550 Entitlement Value Forgone** | Free follow-ups have a value. Recording it makes revenue forgone measurable. **[Confirmed]** the reference project's Fee Validity leaves *no financial trace at all* — the appointment simply disappears from billing. | **[Not Found]** |
| **4560 Claim Denials Written Off** | Denials must land somewhere. **[Confirmed]** the reference project has a *required* `rejected_claims_account` field that nothing ever reads, and non-approved claims cause the service to vanish from billing entirely. | field exists, never read |
| **5490 Bad Debt — Payer** | Payer bad debt behaves differently from patient bad debt and is managed by a different team. | single write-off account |
| **1130 Gateway Clearing** | Card money is authorised before it settles to the bank. Without a clearing account, cash is overstated between the two. | **[Not Found]** as a distinct account |
| **1240 Unbilled Charges** | If revenue is accrued at service delivery rather than at invoicing (§5). | n/a — the reference project only recognises at invoicing |
| **5640 Cash Variance** | Till over/short must be posted, not just noted. **[Confirmed]** the reference project's POS Closing Entry posts **nothing** — its `difference` field is computed in `pos_closing_entry.js` and never reaches the ledger. | **absent** |
| **4930 Registration Fees** | A distinct revenue line. **[Confirmed]** the reference project posts these to the generic income account and — worse — leaves the invoice in **draft** so nothing posts at all. | generic income |
| **4940 No-Show Fees** | Common clinic policy. | **[Not Found]** |
| **2120 AP — Practitioners** | Fee-for-service clinicians are payables, not payroll. | **[Not Found]** — no practitioner-payment concept |

---

## 5. The revenue-recognition timing decision

**[Recommended]** This is a genuine accounting decision the clinic must make, and it changes
the chart.

**Option A — recognise at invoicing** (what the reference project does, **[Confirmed]**).
A clinical service has no accounting consequence until a Sales Invoice is raised for it
(*../03-accounting/accounting-events.md*§2). Simple; but
services delivered and not yet invoiced are invisible in the accounts, and the reference
project has **[Not Found]** no report of unbilled charges — so revenue can be lost silently and
permanently.

**Option B — accrue at service delivery.** Charge capture posts
`Dr 1240 Unbilled Charges / Cr 4xxx Revenue`; invoicing reclassifies
`Dr 1210/1220 AR / Cr 1240 Unbilled Charges`.

| | Option A | Option B |
|---|---|---|
| Complexity | Lower | Higher — every charge posts |
| Ledger volume | One entry per invoice | One per charge **and** one per invoice |
| Revenue completeness | Depends on billing discipline | Structural |
| Matches accrual accounting | Only if billing is same-period | Yes |
| Unbilled revenue visible | Only via a report | On the balance sheet |

**[Recommended]** **Option A plus a mandatory unbilled-charges integrity job**
([clinic-financial-modules.md](clinic-financial-modules.md)§7) for most clinics — the simplicity
is worth more than the precision, *provided* the detector exists. Choose Option B if the clinic
has material billing lag (common with insurer-heavy caseloads), or if auditors require accrual
at point of service. **Decide in Phase 0**; retrofitting is expensive.

---

## 6. Dimensions, not accounts

**[Recommended]** Resist expanding the chart for analysis. Every journal line carries:

| Dimension | Answers |
|---|---|
| `branch_id` | Which site is profitable? |
| `department_id` | Which specialty is profitable? |
| `practitioner_id` | Which clinician generates what revenue? |
| `cost_center_id` | Who owns this cost? |
| `payer_id` (via the party on AR lines) | Which payer, and how promptly? |

**[Confirmed]** the reference project supports exactly this through its generic
`Accounting Dimension` mechanism, which injects a field onto 33 DocTypes including `GL Entry`
(*../03-accounting/dimensions-and-cost-centers.md*).
The idea is right; the runtime custom-field machinery is unnecessary when the axes are known in
advance — use real, indexed columns.

**Rule of thumb:** if the question is *"how much of what kind of money?"* it is an **account**.
If it is *"whose money, or where?"* it is a **dimension**.

---

## 7. Seeding and validation

**[Recommended]** The Phase 2 deliverable:

1. A **seed script** creating the tree in §2 for a new clinic, with codes and types.
2. A **`ClinicAccountMap` seed** populating every purpose in §3.
3. A **completeness validator** that fails loudly on any unmapped purpose, run at setup and as a
   scheduled health check.
4. An **immutability guard**: once any `journal_line` references an account, its `code` and
   `root_type` cannot change. **[Confirmed]** the reference project permits
   `update_account_number`, `merge_account` and `after_rename` on accounts that already carry
   ledger history, silently rewriting the meaning of historical rows.
5. A **test** asserting every `account_type` used by any event in
   [clinic-accounting-events.md](clinic-accounting-events.md) exists in the seeded tree.

---

## Open questions / unverified

1. **The account-code scheme** (4-digit, 1000-blocks) is conventional but arbitrary. Local
   statutory chart requirements may dictate otherwise — check before seeding.
2. **Revenue-line granularity** (§2, 4100 block) is a guess at a general clinic's shape. It must
   be validated against the actual service catalogue; too fine a split creates dozens of
   near-empty accounts.
3. **Per-insurer AR accounts vs one control account with a party dimension** (1221) is a
   trade-off between chart size and reporting convenience. The reference project's per-insurer
   `Party Account` approach works; the party dimension on a single control account is cleaner.
   Either is defensible — decide with the accountant.
4. **Revenue recognition timing** (§5) is unresolved and must be decided in Phase 0.
5. **Whether practitioner fees are payables or payroll** (2120 vs 2140) depends on employment
   arrangements and local tax law.
6. The reference project's full default chart was only partially read (the Asset branch in
   detail, the other four roots by their `root_type` markers). The Expense and Income branches
   of `standard_chart_of_accounts.py`
   should be read in full before concluding that anything is missing from it — see
   *../03-accounting/chart-of-accounts.md*, which
   reproduces the tree.
