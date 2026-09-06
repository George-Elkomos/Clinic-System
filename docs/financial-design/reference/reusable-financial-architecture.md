# Reusable Financial Architecture — What to Take, Adapt, Reject and Improve

**Purpose**
Convert the Layer-1 reverse-engineering into design decisions for the Clinic Management
System. For every significant component, state four things separately and explicitly:
what the reference project **does**, what is **reusable**, what must be **adapted** for a
clinic, and what should be **improved**.

**Scope**
Design-level decisions only. The concrete build sequence is in
[IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md); the target models are in
[clinic-accounting-model.md](clinic-accounting-model.md),
[clinic-data-model.md](clinic-data-model.md) and
[clinic-accounting-events.md](clinic-accounting-events.md).

**Audience**
The architect or lead developer deciding what the clinic system's financial subsystem looks
like, before any code is written.

**Related documents**
- *../11-analysis/strengths.md* / *weaknesses.md* / *risks.md*
- [clinic-financial-modules.md](clinic-financial-modules.md) — the module decomposition
- [implementation-blueprint.md](implementation-blueprint.md) — the final target picture

> **Label discipline.** This is a **Layer 2** document. Statements about the reference project
> keep their **[Confirmed]** / **[Inference]** / **[Not Found]** labels and cite source.
> Design decisions for the clinic system are labelled **[Recommended]** and are *never*
> descriptions of the reference project. The two must not be conflated.

---

## 0. The five decisions that matter most

If you read nothing else in this document, decide these five things deliberately.

| # | Decision | Reference project | **[Recommended]** for the clinic |
|---|---|---|---|
| 1 | **Money type** | `decimal(21,9)` storage, but Python-side `float` arithmetic; healthcare/insurance code uses raw `float()` and `* 0.01` with no precision control | **Integer minor units** (e.g. piastres/cents) in a `Money` value object, or `Decimal` with an explicit rounding policy. Never binary floats. |
| 2 | **Is there a Charge entity?** | **No.** The invoice line *is* the charge; billing state is a boolean `invoiced` flag on the clinical document | **Yes.** A first-class `Charge` with its own lifecycle, linked to both the clinical event and the invoice line. This single change eliminates most healthcare billing defects. |
| 3 | **Ledger immutability** | Append-and-reverse for normal operations, but three paths delete or mutate posted rows (`on_trash` with `delete_linked_ledger_entries`, stock repost, migration patches) | **Strictly append-only.** No `UPDATE`, no `DELETE`, ever. Corrections are always new reversing entries. |
| 4 | **Posting idempotency** | **[Not Found]** — `docstatus` is the only guard; no idempotency key | **Idempotency key on every posting**, unique-constrained, so a retry can never double-post. |
| 5 | **Insurance model** | Invoice raised in full to the patient, then a post-hoc Journal Entry moves the covered portion to the insurer's receivable | **Split at invoice time** into patient-responsible and payer-responsible amounts, each its own receivable line. Model copay/deductible explicitly. |

---

## 1. The accounting core

### 1.1 The ledger

**Reference project [Confirmed]:** one table `tabGL Entry`; every accounting effect is rows
in it; balances are never stored but always derived by `get_balance_on`; cancellation flags
originals `is_cancelled = 1` and inserts side-swapped copies
(*../03-accounting/accounting-model.md*).

**Reusable:** **the entire concept.** A single ledger table, derived balances, and
correction-by-reversal are the three best decisions in the reference project. They are why
its numbers can be trusted even where its documents cannot.

**Clinic adaptation:** none needed. This is domain-neutral.

**Improve [Recommended]:**
- Make the table **strictly append-only** — enforce it in the database (a `BEFORE UPDATE` /
  `BEFORE DELETE` trigger that raises, or `REVOKE UPDATE, DELETE`), not merely by convention.
  This closes the three leaks catalogued in
  *../02-architecture/module-boundaries.md*§3.2.
- Replace the `is_cancelled` flag with an explicit `reverses_entry_id` on the reversing row.
  A flag on the original is a mutation; a pointer on the reversal is not.
- Add a monotonically increasing `sequence_no` and a `posted_at` timestamp distinct from
  `posting_date`, so the *order of recording* is recoverable independently of the
  *accounting date*.
- Add the **idempotency key** from decision 4.

### 1.2 The posting engine

**Reference project [Confirmed]:** 291 lines in
`general_ledger.py`; a single choke point;
insertion happens in exactly one place. The pipeline is: closed-period validation → negative
sign normalisation → merge same-head rows → round-off to force debits = credits → freeze-date
check → per-row insert → outstanding recalculation → budget check.

**Reusable:** the **pipeline shape and the choke point**. Keeping all posting behind one
function is what makes the invariants enforceable at all.

**Clinic adaptation:** none — this is domain-neutral.

**Improve [Recommended]:**
- **Fix the tolerance.** The reference project allows a debit/credit difference of up to
  **`0.5`** for every voucher type except Journal Entry and Payment Entry
  (`general_ledger.py`, `round_off_debit_credit`),
  silently absorbing it into a round-off account. Half a currency unit per voucher is far too
  loose. Use a single tolerance of **one minor unit** for all voucher types — and with
  integer money (decision 1) you can require **exact** equality and dispense with the
  round-off entry except where genuine rounding of a computed tax occurs.
- Make posting **transactional and all-or-nothing** with an explicit unit of work. In the
  reference project each row is inserted by a separate `submit()`; whether earlier inserts
  roll back on a later failure depends on the ambient transaction
  (*../02-architecture/transactions-and-consistency.md*).
- Reject a `gl_map` that fails to balance rather than adjusting it. Adjustment hides bugs.

### 1.3 Chart of accounts

**Reference project [Confirmed]:** hierarchical nested set per company; `root_type` ∈
{Asset, Liability, Income, Expense, Equity}; `report_type` derived; a behavioural
`account_type` tag (Receivable, Payable, Bank, Cash, Stock, Tax, Round Off, …) that unlocks
specific handling; only leaf accounts postable; company-level default-account fields.

**Reusable:** all of it. The `account_type` behavioural tag in particular is an elegant way
to let code find "the receivable account" without hard-coding a code.

**Clinic adaptation [Recommended]:** the *content* of the chart, not its structure. A clinic
needs revenue accounts segmented by service line (consultation, laboratory, radiology,
pharmacy, procedures, inpatient), and receivable control accounts segmented by payer class
(patients, insurers, corporate accounts). See
[clinic-chart-of-accounts.md](clinic-chart-of-accounts.md).

**Improve [Recommended]:**
- Make account codes immutable. The reference project supports renaming and merging accounts
  after they carry ledger history (`update_account_number`, `merge_account`,
  `after_rename`), which rewrites the meaning of historical rows.
- Validate the completeness of a company's default-account map at company creation, not at
  first posting. The reference project's cascades return empty and fail deep inside posting
  (*../04-modules/healthcare-configuration.md*§3).

### 1.4 Dimensions and cost centres

**Reference project [Confirmed]:** cost centre mandatory on every P&L row; a generic
`Accounting Dimension` mechanism that injects a custom field onto 33 DocTypes including
`GL Entry`.

**Reusable:** the concept of *n* orthogonal analysis axes on every ledger row, with a
mandatory-for-P&L rule.

**Clinic adaptation [Recommended]:** a clinic needs at minimum **branch/site**,
**department/specialty**, and **practitioner** as dimensions. The reference project achieves
per-practitioner revenue only by routing to a *different income account*
(*../04-modules/healthcare-configuration.md*§3),
which pollutes the chart of accounts with one account per doctor. **Use a dimension, not an
account.**

**Improve [Recommended]:** model dimensions as first-class columns on the ledger table from
day one rather than as runtime-injected custom fields. You know the clinic's axes in advance;
you do not need the reference project's dynamic-schema machinery.

---

## 2. The revenue cycle

### 2.1 Charge capture — the single most important adaptation

**Reference project [Confirmed]:** there is **no Charge entity**. Ten collector functions in
`healthcare/utils.py` scan clinical documents for
`invoiced = 0`, build a list of item/rate/reference dicts, and
`SalesInvoice.set_healthcare_services` turns them into invoice lines. Billing state is the
boolean `invoiced` flag, written back by raw `frappe.db.set_value`.

**Consequences documented in *../04-modules/healthcare-billing.md*§7:**
no audit trail of who billed what; check-then-set race with no lock; cancelling *any* invoice
frees the clinical event regardless of which invoice billed it; no partial billing; draft
clinical documents offered for billing; emergency services re-billed indefinitely.

**Reusable:** the **collector contract** — a uniform
`{source_type, source_id, service, rate, qty, revenue_account, …}` shape is a good interface.
Also reusable: `is_billable` living on the service *template*, not the instance.

**Clinic adaptation — [Recommended] the target design:**

```
Clinical event (Encounter, LabOrder, Procedure, Occupancy, Dispense …)
        │  emits a domain event
        ▼
   ┌──────────────────────────────────────────────────────────┐
   │  CHARGE                                                  │
   │  id, clinic_id, patient_id, encounter_id                 │
   │  source_type, source_id           ← the clinical event   │
   │  service_id, quantity, unit_price, gross_amount          │
   │  discount_amount, net_amount                             │
   │  payer_split: [ {payer_type, payer_id, amount, basis} ]  │
   │  revenue_account_id, cost_center_id, dimensions          │
   │  status: DRAFT → CAPTURED → INVOICED → CANCELLED         │
   │           └─ VOIDED (never invoiced)                     │
   │  invoice_line_id  (nullable, set exactly once)           │
   │  service_date, captured_at, captured_by                  │
   └──────────────────────────────────────────────────────────┘
        │
        ▼  invoice run groups CAPTURED charges by patient+payer
   Invoice → Invoice Line (1:1 with Charge)
```

Why every one of the reference project's defects disappears:

| Reference defect | Fixed by |
|---|---|
| No audit of billing state | `Charge` is a document with `created_at`/`by` and a status history |
| Check-then-set race | `charge.invoice_line_id` set once under a unique constraint; the DB rejects the second write |
| Cancelling any invoice frees the event | `Charge` points at *its* invoice line; cancelling a different invoice cannot touch it |
| No partial billing | Multiple `Charge` rows per clinical event, each independently billable |
| Draft documents billable | `Charge` is only created when the clinical event reaches a billable state |
| Re-billing emergency services | A `Charge` exists once; there is no "scan for unbilled" query to get wrong |
| Rate resolution scattered | One pricing service resolves the rate once, at capture time, and **stores it** |

**Improve further [Recommended]:** capture the price **at the time of service**, on the
Charge. The reference project resolves rates at *invoicing* time from the current price list,
so a price change between service and billing silently re-prices delivered care. Storing the
price on the Charge also gives you a defensible record of what was quoted.

### 2.2 Invoicing

**Reference project [Confirmed]:** `Sales Invoice`, 1,949 lines, mixing party resolution,
pricing, tax, stock, POS, loyalty, healthcare and posting. Posts
Dr Receivable / Cr Income (+ tax, discount, write-off, rounding rows).

**Reusable:** the **posting shape** and the status model
(Draft / Unpaid / Partly Paid / Paid / Overdue / Return / Credit Note Issued / Cancelled).
Also the `Payment Schedule` child for instalments and due dates.

**Clinic adaptation [Recommended]:**
- An invoice belongs to **one payer**, not one patient. A patient encounter covered 80% by an
  insurer produces **two** invoices (or one invoice with two payer-responsible sections) —
  not one invoice plus a corrective journal.
- Group charges into invoices by **encounter or episode**, which is what patients and payers
  expect to see, rather than by an ad-hoc "everything unbilled for this patient" sweep.

**Improve [Recommended]:**
- Keep the invoice thin: it aggregates Charges and owns totals, tax and terms. Pricing belongs
  to the pricing service; charge capture to the Charge; posting to the ledger service.
- Make `outstanding_amount` a **derived read model**, not a column mutated by the ledger
  writer (see 2.4).

### 2.3 Pricing, discounts and tax

**Reference project [Confirmed]:** price lists + item prices + pricing rules + promotional
schemes; line and invoice-level discounts; a genuinely sophisticated tax engine in
`taxes_and_totals.py` with five charge types
and correct inclusive-tax fraction maths.

**Reusable:** **the tax algorithm.** The five charge types (`Actual`, `On Net Total`,
`On Previous Row Amount`, `On Previous Row Total`, `On Item Quantity`) and the
inclusive-to-exclusive derivation are correct and non-trivial — reimplement the *algorithm*
even though the 807-line implementation is not portable.

**Clinic adaptation [Recommended]:** clinics price by **payer contract**, not by a single
selling price list. The same procedure has a cash price, an Insurer A price and a corporate
price. The reference project gestures at this — `Healthcare Insurance Coverage Plan.price_list`
and `Healthcare Insurance Contract.default_price_list` — but the cascade silently yields
`0.0` when no `Item Price` row exists
(*../04-modules/healthcare-insurance.md*§4).

**Improve [Recommended]:** make a missing price a **hard error at charge capture**, never a
silent zero. A clinic that bills nothing for delivered care has a worse problem than one that
cannot save a record.

### 2.4 Receivables

**Reference project [Confirmed]:** receivables are GL rows on `account_type = 'Receivable'`
accounts, distinguished by `party_type`/`party`. `outstanding_amount` is **denormalised** onto
the invoice by `update_outstanding_amt` in
`gl_entry.py` on every settling row,
with no locking.

**Reusable:** receivables-as-ledger-rows with a party dimension. Correct, and it means AR
always reconciles to the GL by construction.

**Clinic adaptation [Recommended]:** **separate receivable control accounts per payer class**
— Patients, Insurers, Corporate. The reference project achieves insurer segregation by
attaching a `Party Account` row to the insurer's Customer
(*../04-modules/healthcare-insurance.md*§2.1); that
mechanism is sound and worth keeping.

**Improve [Recommended]:** do not denormalise `outstanding_amount` onto the invoice as a
mutable column updated by the ledger writer. Either derive it on read, or maintain it as an
explicitly-rebuilt projection with a reconciliation job that detects drift. The reference
project's approach is its single largest consistency risk.

### 2.5 Payments

**Reference project [Confirmed]:** `Payment Entry` with Receive/Pay/Internal Transfer,
allocation to references, unallocated remainder as an advance, deductions for write-off and
exchange differences.

**Reusable:** the **payment/allocation split** — a payment is one thing, its allocation to
invoices is another, and the remainder is an advance on the party account. This is the right
model and handles part-payments, over-payments and prepayments uniformly.

**Clinic adaptation [Recommended]:** a clinic needs
**patient deposits/advances as a first-class concept** — money taken before treatment,
against which charges are later applied. The reference project has generic advances but
**[Not Found]** no healthcare wiring for them. Also needed: **cashier shift/till
reconciliation**, for which the reference project's `POS Opening Entry` / `POS Closing Entry`
are a reasonable starting point.

**Improve [Recommended]:** every payment gets an **idempotency key**, and gateway callbacks
are deduplicated on the provider's transaction id with a unique constraint. The reference
project has `validate_transaction_reference` but **[Not Found]** no idempotency guarantee.

### 2.6 Refunds, credit notes and adjustments

**Reference project [Confirmed]:** returns via `is_return = 1` producing negative-value
invoices; write-offs to a dedicated account; corrections by cancel-and-amend.

**Reusable:** credit-note-as-negative-invoice, and **never editing a posted document**.

**Clinic adaptation [Recommended]:** clinics need a distinct vocabulary because the accounting
differs: **refund** (money returned), **credit note** (charge reversed before payment),
**write-off** (charge abandoned), **contractual adjustment** (the difference between list
price and the payer-contracted price — routine in healthcare and **[Not Found]** entirely
absent from the reference project). Contractual adjustment must be its own account and its own
event, or gross revenue is overstated.

---

## 3. The payer layer — the largest single adaptation

**Reference project [Confirmed]:** documented in full in
*../04-modules/healthcare-insurance.md*. In summary:
insurer is a Customer with its own receivable account; coverage rules per plan and service;
per-service-line claims; the invoice is raised in full to the patient and a post-hoc Journal
Entry moves `coverage_amount` to the insurer.

**Reusable concepts — genuinely good ideas worth keeping:**
1. The insurer modelled as an ordinary **party** with its own **receivable control account**.
   This gives insurer AR, ageing and statements for free.
2. **Coverage rules** resolved by a priority cascade (specific service → item → item group →
   medical code).
3. A **contract** with a validity window gating the whole relationship.
4. **Per-service-line claims**, which is the granularity payers actually adjudicate at.

**Reject — do not port:**
- The post-hoc AR-transfer Journal Entry. It fires from `on_update_after_submit` with no
  idempotency guard, has no `on_cancel`, and re-fires on invoice cancellation
  (*../04-modules/healthcare-insurance.md*§9.1–9.2).
- Raw-float coverage arithmetic (§9.3).
- Dropping unbilled services when a claim is `Pending` or `Rejected` (§8) — silent revenue
  loss with no exception report.
- `billing_amount` as a `Data` field carrying the whole invoice total per claim (§9.4).

**Clinic adaptation [Recommended] — the target payer model:**

```
Payer (abstract)  ──┬── SelfPay (the patient)
                    ├── Insurer      (contract, plans, coverage rules)
                    └── CorporateAccount (employer/embassy/NGO — [Not Found] in the reference)

Charge
  └── PayerSplit[]   ← computed ONCE at capture, stored, never recomputed
        { payer_type, payer_id, amount, basis }
        basis ∈ { COVERAGE, COPAY, DEDUCTIBLE, EXCLUSION,
                  CONTRACTUAL_ADJUSTMENT, SELF_PAY }

Invoice(payer)  ← one invoice per payer, each posting its own receivable
```

**Split at capture, not after the fact.** Compute the split when the charge is created, store
it, and let each payer's portion become its own invoice line against its own receivable
control account. The insurer's receivable then arises from an *invoice*, not from a corrective
journal — which means it ages correctly, appears on statements, and reverses properly when the
invoice is cancelled.

**Add what is missing [Recommended]** — all **[Not Found]** in the reference project:

| Concept | Why a clinic needs it |
|---|---|
| **Copayment** | The fixed patient portion per visit. Currently inexpressible. |
| **Deductible** | Annual patient-borne amount before coverage starts. Requires per-patient-per-year accumulators. |
| **Benefit cap / annual maximum** | `maximum_number_of_claims` exists but nothing reads it. |
| **Contractual adjustment** | The list-vs-contract price difference. Without it, revenue is overstated. |
| **Pre-authorisation** | An authorisation number obtained before service, referenced on the claim. |
| **Claim batch & remittance** | Claims are adjudicated and paid in batches with partial approvals. `total_approved_amount` exists but is never written. |
| **Denial management** | A rejected claim must route to patient responsibility, appeal, or write-off — never silently vanish. |

---

## 4. Governance

### 4.1 Permissions and approval

**Reference project [Confirmed]:** per-DocType role permissions with `permlevel` field
restrictions; `docstatus` submit/cancel as the entire approval model;
**[Not Found]** no shipped Workflow definitions for financial documents. Healthcare
auto-invoicing submits with **both** `ignore_permissions=True` and `ignore_mandatory=True`
(*../04-modules/healthcare-billing.md*§5).

**Reusable:** role×operation permissions including a distinct **submit** and **cancel** right,
separate from write. That distinction is exactly right for financial documents.

**Improve [Recommended]:**
- **Explicit approval workflows** for defined thresholds: refunds above X, write-offs,
  manual journal entries, price overrides.
- **Enforced separation of duties**: the user who creates a payment cannot be the user who
  approves it. The reference project permits this only by role design, not by rule.
- **No permission bypass on any money-posting path.** If a background process must post, give
  it a service principal with real, audited permissions.

### 4.2 Audit

**Reference project [Confirmed]:** `owner`/`creation`/`modified`/`modified_by` on every row;
`track_changes` versioning on most financial DocTypes; ledger correction by reversal. **But**
the Healthcare module writes billing state with `frappe.db.set_value`, which bypasses
versioning entirely, and several `allow_on_submit` fields remain editable after posting.

**Improve [Recommended]:**
- An **append-only financial audit log** separate from generic change tracking, recording
  every money-affecting operation: who, when, from where, before, after, and why.
- **A mandatory reason** on every reversal, write-off, adjustment and price override.
- Nothing that affects money is ever changed by a direct SQL write.

---

## 5. What to deliberately leave behind

**[Recommended]** Do not port these, even though the reference project has them:

| Component | Why not |
|---|---|
| Deep controller inheritance (`SalesInvoice` → `SellingController` → `StockController` → …) | Every invoice becomes a stock document; behaviour is spread across five files. Use composition. |
| `.py`/`.js` duplicated calculation | Two sources of truth for money. Calculate server-side; the client displays. |
| Runtime schema injection (Accounting Dimensions as custom fields) | You know your dimensions in advance. Use real columns. |
| `regional_overrides` monkey patching | Powerful but makes the call graph statically undeterminable. Use explicit strategy objects per jurisdiction. |
| Loyalty points, coupons, promotional schemes | Retail features. A clinic needs payer contracts, not coupons. |
| Shares/shareholders, invoice discounting, dunning interest | Out of scope for a clinic's first several releases. |
| The `Fee Validity` free-follow-up mechanism as implemented | The *policy* is reasonable; the implementation tests different conditions in three places and mis-handles the first visit (*../04-modules/healthcare-billing.md*§5–6). Reimplement as an explicit entitlement on the Charge. |

---

## 6. Decision summary table

| Area | Reference | Reuse | Adapt | Improve |
|---|---|---|---|---|
| Ledger table | Single `tabGL Entry`, derived balances | ✅ wholesale | — | strict append-only; `reverses_entry_id`; sequence no. |
| Posting engine | 291-line choke point | ✅ pipeline shape | — | exact balance; idempotency key; explicit UoW |
| Money type | decimal storage, float arithmetic | ❌ | — | integer minor units / Decimal |
| Chart of accounts | Nested set + `account_type` tags | ✅ structure | clinic-specific content | immutable codes; validate defaults at setup |
| Dimensions | Generic, injected | ✅ concept | branch, department, practitioner | real columns, not custom fields |
| Charge capture | ❌ no Charge entity | collector *contract* only | **first-class `Charge`** | price captured at service time |
| Invoicing | 1,949-line document | posting shape, status model | one invoice per **payer** | thin invoice; derived outstanding |
| Pricing | Price lists + rules | ✅ | payer-contract pricing | missing price = hard error |
| Tax | 5 charge types, inclusive maths | ✅ algorithm | usually simpler for a clinic | — |
| Receivables | GL rows + denormalised column | ✅ ledger rows | per-payer-class control accounts | derived or reconciled projection |
| Payments | Payment + allocation + advance | ✅ wholesale | patient deposits; cashier shifts | idempotency keys |
| Refunds | Returns, write-offs | ✅ | add contractual adjustment | mandatory reason codes |
| **Insurance** | Post-hoc AR-transfer JE | insurer-as-party; coverage rules; contract; per-line claims | **split at capture**; copay/deductible/cap; denial management | never a corrective journal |
| Permissions | Role × doctype, docstatus | ✅ submit/cancel rights | clinic roles | approval workflows; enforced SoD |
| Audit | Row metadata + versioning | ✅ | — | append-only financial audit log; reason codes |
| Reporting | 41 reports over the ledger | ✅ derive-from-ledger | clinic KPIs | — |

---

## Open questions / unverified

1. Several **[Recommended]** items assume the clinic system is being built outside Frappe. If
   it is being built *on* Frappe/ERPNext, some improvements (integer money, real dimension
   columns, DB-level append-only enforcement) are harder and the trade-offs change. The
   implementation plan flags where this matters.
2. The tax algorithm's reusability is asserted from its structure; the detailed correctness
   review lives in *../04-modules/taxes.md* and should be read before
   reimplementing.
3. Whether a clinic needs multi-currency at all is deployment-specific. The reference
   project's dual-column ledger design is the right answer *if* it is needed, and pure
   overhead if not.
4. Corporate/third-party-payer requirements are asserted from general clinic practice, not
   from the reference project, which has **[Not Found]** no such concept. Validate against
   the actual business before building.
