# Clinic Financial Modules — Target Decomposition

**Purpose**
Define the modules of the clinic system's financial subsystem: what each owns, its public
interface, its dependencies, and its boundary with the clinical side. This is the map the
implementation plan's phases follow.

**Scope**
Module decomposition and the charge-capture design that replaces the reference project's
`invoiced` boolean. The accounting core is specified separately in
[clinic-accounting-model.md](clinic-accounting-model.md).

**Audience**
The developer implementing Phases 4–9 of [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md).

**Related documents**
- [clinic-accounting-model.md](clinic-accounting-model.md) — the ledger this all posts to
- [clinic-accounting-events.md](clinic-accounting-events.md) — the event→entry contract
- [clinic-data-model.md](clinic-data-model.md) — the schema
- *../04-modules/healthcare-billing.md* — the reference implementation being replaced
- *../02-architecture/module-boundaries.md* — the boundary failures being avoided

> **Layer 2 document.** **[Recommended]** marks design decisions. Statements about the
> reference project retain their evidence labels.

---

## 1. Module map

**[Recommended]** Seven financial modules. Dependencies point downward only; no module may
import from a module above it.

```
 ┌──────────────────────────────────────────────────────────────────────┐
 │  CLINICAL MODULES  (not financial — they only emit events)           │
 │  Scheduling · Encounters · Orders · Laboratory · Radiology ·         │
 │  Pharmacy · Inpatient · Procedures                                   │
 └────────────────────────────┬─────────────────────────────────────────┘
                              │  domain events (ServiceRendered, …)
                              │  ONE-WAY. Clinical modules never import financial ones.
 ┌────────────────────────────▼─────────────────────────────────────────┐
 │  M6  CHARGE CAPTURE                                                  │
 │      Listens to clinical events → creates Charges                    │
 │      Owns: Charge, ChargeStatus, PayerSplit                          │
 │      Depends on: M5 Pricing, M4 Payer                                │
 └────────────────────────────┬─────────────────────────────────────────┘
                              │
 ┌──────────────────┬─────────┴─────────┬──────────────────────────────┐
 │  M5  PRICING     │  M4  PAYER         │  M7  REVENUE INTEGRITY      │
 │  Service catalog │  Patient(SelfPay)  │  Denials · appeals ·        │
 │  Price lists     │  Insurer+contract  │  unbilled-charge alerts ·   │
 │  Payer tariffs   │  Corporate account │  reconciliation jobs        │
 │  Coverage rules  │  Coverage · copay  │  Depends on: M1–M6          │
 │  Discount policy │  Deductible · cap  │                             │
 └──────────────────┴─────────┬──────────┴──────────────────────────────┘
                              │
 ┌────────────────────────────▼─────────────────────────────────────────┐
 │  M3  BILLING & AR                                                    │
 │      Invoice · InvoiceLine · CreditNote · Statement · Ageing         │
 │      Claim · ClaimBatch · Remittance                                 │
 │      Depends on: M2 Payments (for allocation state), M1 Accounting   │
 └────────────────────────────┬─────────────────────────────────────────┘
                              │
 ┌────────────────────────────▼─────────────────────────────────────────┐
 │  M2  CASH & PAYMENTS                                                 │
 │      Payment · Allocation · Deposit/Advance · Refund                 │
 │      CashierShift · Till · BankAccount · Gateway adapters            │
 │      Depends on: M1                                                  │
 └────────────────────────────┬─────────────────────────────────────────┘
                              │
 ┌────────────────────────────▼─────────────────────────────────────────┐
 │  M1  ACCOUNTING CORE                                                 │
 │      Money · Account · JournalEntry · JournalLine · Period           │
 │      PostingService (the one door) · BalanceService · Integrity      │
 │      Depends on: NOTHING financial. Fully testable in isolation.     │
 └──────────────────────────────────────────────────────────────────────┘
```

**[Recommended]** The critical structural rule, which the reference project violates:
**clinical modules must never import financial modules, and the accounting core must never
import anything above it.** In the reference project,
`sales_invoice.py:28`
imports `erpnext.healthcare.utils` at module level, so the accounts module cannot function
without the healthcare module
(*../02-architecture/module-boundaries.md*§2.2).
Use events in that direction, always.

---

## 2. M6 — Charge Capture: the central adaptation

This module is the reason the clinic system will be more reliable than the reference project.

### 2.1 What the reference project does, and the seven defects it causes

**[Confirmed]** There is no Charge entity. Billing state is a boolean `invoiced` flag on the
clinical document, and ten collector functions in
`healthcare/utils.py` scan for `invoiced = 0` at invoicing
time. `set_invoiced` writes the flag back with raw `frappe.db.set_value`.

**[Confirmed]** the resulting defects, documented in
*../04-modules/healthcare-billing.md*§7:

| # | Defect |
|---|---|
| 1 | Emergency services have no `invoiced` filter — re-billed on every invoice screen |
| 2 | Whole-multiple occupancy stays bill as **half a unit** (a 24-hour stay bills 0.5 days) |
| 3 | Billing state changes leave **no audit trail** |
| 4 | Check-then-set on `invoiced` is **not atomic** — two concurrent invoices both pass |
| 5 | Cancelling **any** invoice clears the flag, regardless of which invoice billed it |
| 6 | Draft clinical documents are offered for billing |
| 7 | A missing `Item Price` **silently bills zero** |

### 2.2 [Recommended] the Charge entity

```
charge
  id                  uuid pk
  clinic_id           uuid not null
  branch_id           uuid not null
  patient_id          uuid not null
  encounter_id        uuid null          -- the episode this belongs to
  -- provenance: what clinical act caused this
  source_type         text not null      -- 'Encounter'|'LabOrder'|'Procedure'|
                                         -- 'Occupancy'|'Dispense'|'Imaging'|'Consultation'
  source_id           uuid not null
  service_id          uuid not null      -- the priced service
  service_date        date not null      -- WHEN CARE WAS GIVEN (not when billed)
  -- amounts, all integer minor units, resolved ONCE at capture
  quantity            numeric(12,3) not null
  unit_price_minor    bigint not null    -- captured at service time, never re-read
  gross_minor         bigint not null    -- quantity × unit_price
  discount_minor      bigint not null default 0
  net_minor           bigint not null    -- gross − discount
  currency            char(3) not null
  -- accounting targets, resolved at capture
  revenue_account_id  uuid not null
  cost_center_id      uuid not null
  department_id       uuid null
  practitioner_id     uuid null
  -- lifecycle
  status              enum(DRAFT, CAPTURED, INVOICED, VOIDED, WRITTEN_OFF)
  captured_at         timestamptz
  captured_by         uuid
  void_reason         text
  -- pricing provenance, for disputes
  price_list_id       uuid
  payer_contract_id   uuid null
  UNIQUE (source_type, source_id, service_id)   -- ← defect 1 and 4 both die here

charge_payer_split                       -- computed once at capture, stored, never recomputed
  id                  uuid pk
  charge_id           uuid fk not null
  payer_type          enum(SELF_PAY, INSURER, CORPORATE)
  payer_id            uuid not null
  amount_minor        bigint not null
  basis               enum(COVERAGE, COPAY, DEDUCTIBLE, EXCLUSION,
                           CONTRACTUAL_ADJUSTMENT, SELF_PAY)
  invoice_line_id     uuid null UNIQUE   -- ← defect 5 dies here
  claim_id            uuid null
  CHECK (amount_minor >= 0)
  -- INVARIANT (job-enforced): Σ splits per charge == charge.net_minor
```

### 2.3 How each defect is structurally eliminated

| Reference defect | Structural fix |
|---|---|
| 1 — re-billing | `UNIQUE (source_type, source_id, service_id)` makes a second charge for the same act impossible. There is no "scan for unbilled" query to get wrong. |
| 2 — occupancy maths | One occupancy-quantity function, unit-tested against a table of boundary cases (see §2.5). |
| 3 — no audit | `charge` is a real entity with `captured_at`/`captured_by` and an append-only `charge_status_history`. |
| 4 — race | `charge_payer_split.invoice_line_id UNIQUE` — the database rejects the second writer. No application-level check-then-set. |
| 5 — wrong cancel | The split points at *its* invoice line. Cancelling a different invoice cannot touch it. |
| 6 — draft billing | A charge is created only when the clinical event reaches a billable state, by the event handler. There is no query over drafts. |
| 7 — silent zero | `unit_price_minor` is `NOT NULL` and the pricing service **raises** on a missing price. |

### 2.4 [Recommended] the charge lifecycle

```
   clinical event (ServiceRendered)
            │
            ▼
        [DRAFT] ──────────► [VOIDED]        (clinical correction; never invoiced)
            │  price resolved, split computed
            ▼
      [CAPTURED] ─────────► [VOIDED]        (requires reason; not yet invoiced)
            │  invoice run
            ▼
      [INVOICED] ─────────► [WRITTEN_OFF]   (invoice cancelled/credited →
            │                                back to CAPTURED, or WRITTEN_OFF)
            ▼
        (settled via payment allocation — charge status unchanged)
```

**[Recommended]** `VOIDED` and `WRITTEN_OFF` are distinct and must not be conflated:
- `VOIDED` — the charge should never have existed. No revenue was ever recognised. No ledger
  entry.
- `WRITTEN_OFF` — the charge was legitimate and invoiced; the money will not be collected.
  Posts Dr `WRITE_OFF` / Cr receivable.

The reference project has no equivalent distinction; clearing `invoiced = 0` covers both cases
indistinguishably.

### 2.5 Occupancy quantity — the corrected function

**[Confirmed]** the reference implementation
(`healthcare/utils.py`, both
`get_inpatient_services_to_invoice` and `get_emergency_services_to_invoice`):

```python
qty = 0.5
if hours_occupied > 0:
    actual_qty = hours_occupied / service_unit_type.no_of_hours
    floor = math.floor(actual_qty)
    decimal_part = actual_qty - floor
    if decimal_part > 0.5:      qty = rounded(floor + 1, 1)
    elif decimal_part < 0.5 and decimal_part > 0:  qty = rounded(floor + 0.5, 1)
    if qty <= 0: qty = 0.5
```

When `decimal_part` is exactly `0` or exactly `0.5`, **neither branch executes** and `qty`
keeps its initial `0.5`. A 24-hour stay bills half a day; a 48-hour stay bills half a day.

**[Recommended]** the replacement, with the policy stated explicitly rather than implied:

```
occupancy_units(check_in, check_out, unit_hours, min_units=0.5, granularity=0.5):
    if check_out is None:  raise NotDischargedYet
    if check_out <= check_in: return min_units
    hours = (check_out - check_in) in hours          # exact, from timestamps
    raw   = hours / unit_hours
    units = ceil(raw / granularity) * granularity    # always round UP to the granularity
    return max(units, min_units)
```

Mandatory test table:

| Hours | unit_hours | Expected units | Reference project gives |
|---|---|---|---|
| 0 | 24 | 0.5 | 0.5 ✓ |
| 4 | 24 | 0.5 | 0.5 ✓ |
| 12 | 24 | 0.5 | 0.5 ✓ |
| 13 | 24 | 1.0 | 1.0 ✓ |
| **24** | 24 | **1.0** | **0.5 ✗** |
| 25 | 24 | 1.5 | 1.5 ✓ |
| **36** | 24 | **1.5** | **0.5 ✗** |
| 37 | 24 | 2.0 | 2.0 ✓ |
| **48** | 24 | **2.0** | **0.5 ✗** |

**[Recommended]** Whether to round up, to the nearest, or to bill actual hours is a *business*
decision. Whatever is chosen, it must be a single named function with this test table beside
it.

### 2.6 Clinical event → charge mapping

**[Recommended]** One handler per clinical event type. Compare with the reference project's
ten inconsistent collectors
(*../04-modules/healthcare-billing.md*§1.1).

| Clinical event | Charge(s) created | Quantity | Notes |
|---|---|---|---|
| `ConsultationCompleted` | 1 consultation charge | 1 | Practitioner tariff; entitlement check may suppress (§2.7) |
| `LabOrderResulted` | 1 per test | 1 | Panel → either one charge or one per component; decide and document |
| `ProcedurePerformed` | 1 procedure charge (+ consumables) | 1 | Consumables as separate charges with their own revenue account |
| `ImagingStudyCompleted` | 1 per study | 1 | |
| `MedicationDispensed` | 1 per dispensed item | dispensed qty | Also triggers inventory COGS posting |
| `OccupancyEnded` | 1 per occupancy segment | §2.5 formula | **Only on discharge/transfer** — never while `check_out` is null |
| `TherapySessionCompleted` | 1 per session, or 1 per plan | 1 | Plan-level packages need a package charge model |
| `PatientRegistered` | 1 registration charge | 1 | Only if the clinic charges one |
| `NoShowRecorded` | 1 no-show fee, if policy | 1 | **[Not Found]** in the reference project; common in practice |

**[Recommended]** Every handler is **idempotent** — re-delivering the event creates no second
charge, guaranteed by the unique constraint, not by a check.

### 2.7 Entitlements — replacing Fee Validity

**[Confirmed]** The reference project's free-follow-up mechanism tests different conditions in
three places, and `invoice_appointment` declines to bill a *new* patient's first visit while
also consuming a free slot for it
(*../04-modules/healthcare-billing.md*§5–6).

**[Recommended]** Model it as an explicit entitlement, evaluated once at charge capture:

```
entitlement
  id, patient_id, practitioner_id (null = any), service_id (null = any)
  kind        enum(FREE_FOLLOW_UP, PACKAGE_SESSION, PREPAID_DEPOSIT)
  granted_by  -- the charge/invoice/package that created it
  total_units, consumed_units
  valid_from, valid_to
  status      enum(ACTIVE, EXHAUSTED, EXPIRED)

entitlement_consumption          -- append-only
  id, entitlement_id, charge_id, units, consumed_at
```

At capture: if an active entitlement matches, create the charge at
`net_minor = 0` with `discount_minor = gross_minor` and a `basis` of the entitlement, **and
record the consumption**. The charge still exists, so the service delivered is visible and
countable — unlike the reference project, where a free follow-up leaves no financial trace at
all. Revenue forgone becomes measurable.

---

## 3. M5 — Pricing

**[Recommended]** Owns the service catalogue and every rate.

```
service            : id, code, name, category, revenue_account_id, is_active,
                     default_cost_center_id, taxable, tax_group_id
price_list         : id, clinic_id, name, currency, valid_from, valid_to,
                     kind enum(CASH, PAYER_TARIFF, CORPORATE, INTERNAL)
service_price      : id, price_list_id, service_id, unit_price_minor,
                     valid_from, valid_to     -- ← time-versioned, never overwritten
discount_policy    : id, scope, basis(PERCENT|AMOUNT), value, requires_approval_above,
                     revenue_account_id       -- discounts get their OWN account
```

**[Recommended]** Three rules that differ from the reference project:

1. **`resolve_price(service, payer, date)` raises** when no price exists. The reference
   project's `get_insurance_price_list_rate` returns `0.0` silently
   (*../04-modules/healthcare-insurance.md*§4), and the
   standard path falls back to an empty `price_list_rate`. A clinic billing zero for delivered
   care is worse than a clinic that cannot save a record.
2. **Prices are time-versioned and resolved by `service_date`**, not by today's date. The
   reference project's coverage resolution uses `nowdate()` unconditionally
   (*../04-modules/healthcare-insurance.md*§3.1), so
   back-dated billing applies today's prices to past care.
3. **Discounts post to their own account.** **[Confirmed]** the reference project nets
   invoice-level discounts into the income credit, making discounts *invisible in the ledger*
   (*../03-accounting/accounting-events.md*§1.1). Post
   gross revenue and a contra-revenue discount line so that gross-to-net is reportable.

---

## 4. M4 — Payer

**[Recommended]** Generalises the reference project's insurance model, which is conceptually
right but structurally incomplete.

```
payer (polymorphic)
  ├── SelfPay          → the patient
  ├── Insurer          → contract, plans, coverage rules
  └── CorporateAccount → employer / embassy / NGO   ([Not Found] in the reference project)

Each payer has:
  - a party record
  - its OWN receivable control account   ← keep this from the reference project
  - a price list / tariff
  - a statement and an ageing profile
```

**[Confirmed]** Keep from the reference project:
- Insurer-as-party with a dedicated receivable account, bound via a `Party Account` row on the
  insurer's Customer (*../04-modules/healthcare-insurance.md*§2.1).
  This is genuinely good — it gives insurer AR, ageing and statements for free.
- Coverage rules resolved by a priority cascade: specific service → item → item group →
  medical code.
- A contract with a validity window gating the whole relationship.
- Per-service-line claims — the granularity payers actually adjudicate at.

**[Recommended]** Add what is missing — all **[Not Found]** in the reference project:

```
coverage_rule    : payer_plan_id, match(service|category|code), coverage_pct,
                   copay_fixed_minor, copay_pct, requires_preauth,
                   excluded, valid_from, valid_to      -- end_date ACTUALLY ENFORCED
benefit_accumulator : patient_id, plan_id, benefit_year,
                      deductible_met_minor, out_of_pocket_minor, benefit_used_minor
                      -- required for deductibles and annual caps
preauthorization : id, patient_id, service_id, payer_id, auth_number,
                   approved_units, valid_from, valid_to, status
claim            : id, charge_id, payer_id, claimed_minor, approved_minor,
                   denied_minor, denial_code, status
claim_batch      : id, payer_id, period, claims[], submitted_at, remittance_id
remittance       : id, payer_id, received_minor, allocations[], variance_minor
```

**[Recommended]** The split is computed **once, at charge capture** by a single function:

```
split(charge, patient_coverage, accumulators) -> [PayerSplit]

  ordered:
   1. excluded service?            → 100% SELF_PAY, basis EXCLUSION
   2. preauth required & missing?  → 100% SELF_PAY, flag for follow-up
   3. contractual adjustment       = list_price − contracted_price   (its own basis)
   4. deductible not yet met       → up to the remaining deductible → SELF_PAY
   5. copay (fixed or %)           → SELF_PAY, basis COPAY
   6. annual cap reached           → excess to SELF_PAY
   7. remainder × coverage_pct     → INSURER, basis COVERAGE
   8. balance                      → SELF_PAY

  POST-CONDITION: Σ splits == charge.net_minor    (Money.allocate guarantees it)
```

**[Recommended]** Three behaviours to explicitly *not* copy:

| Reference behaviour | Evidence | Replacement |
|---|---|---|
| Post-hoc AR-transfer Journal Entry | *../04-modules/healthcare-insurance.md*§6 | Split at capture; each payer's portion becomes its own invoice line against its own receivable. The insurer's receivable then arises from an invoice — it ages correctly and reverses properly. |
| A `Pending`/`Rejected` claim causes the service to vanish from billing | ″ §8 | Denial routes the amount to `SELF_PAY`, appeal, or `WRITTEN_OFF` — never nowhere. M7 raises an alert. |
| Rejected-claim account required but never read | ″ §9.6 | Denials post an explicit entry, or reroute; either way they are visible. |

---

## 5. M3 — Billing & AR

**[Recommended]** Thin. It aggregates charges and owns totals, tax, terms and the receivable.

```
invoice
  id, clinic_id, branch_id, number (immutable, gapless per series)
  payer_type, payer_id            -- ONE payer per invoice
  patient_id                      -- always recorded, even on a payer invoice
  encounter_id / episode_id       -- what the patient recognises
  issue_date, due_date, period_id
  subtotal_minor, discount_minor, tax_minor, total_minor
  currency, exchange_rate
  status enum(DRAFT, ISSUED, PARTIALLY_PAID, PAID, OVERDUE,
              CREDITED, CANCELLED, WRITTEN_OFF)
  journal_entry_id                -- the posting, set once
  UNIQUE (clinic_id, number)

invoice_line
  id, invoice_id, line_no
  charge_id            -- nullable only for non-charge lines (e.g. a late fee)
  charge_split_id UNIQUE   -- ← guarantees a split is invoiced at most once
  description, quantity, unit_price_minor, discount_minor,
  net_minor, tax_minor, total_minor
  revenue_account_id, cost_center_id, department_id, practitioner_id
```

**[Recommended]** Deliberate differences from the reference project:

| Decision | Reference | Rationale |
|---|---|---|
| One invoice per **payer** | One invoice to the patient, then a corrective journal | The insurer's receivable arises from a real document |
| `outstanding` is **derived**, not a mutable column | `update_outstanding_amt` writes `outstanding_amount` on every settling GL row, with no locking | Removes the system's largest consistency risk (*../02-architecture/transactions-and-consistency.md*) |
| Grouped by **encounter/episode** | An ad-hoc "everything unbilled for this patient" sweep | Matches what patients and payers expect to see |
| Invoice numbers gapless and immutable | Naming series; amendment creates a **new** name | Tax authorities require gapless sequences; amendment breaking the number is a real problem |
| Status is computed from allocations | `set_status` with many branches | Fewer states, each derivable |

**[Recommended]** Keep from the reference project: the payment-schedule/instalment child, and
the credit-note-as-negative-invoice model.

---

## 6. M2 — Cash & Payments

**[Recommended]** Keep the reference project's payment/allocation split — it is the right
model and handles part-payment, over-payment and prepayment uniformly.

```
payment
  id, clinic_id, branch_id, number
  direction enum(IN, OUT)
  payer_type, payer_id
  method enum(CASH, CARD, TRANSFER, WALLET, CHEQUE, GATEWAY)
  amount_minor, currency
  received_at, shift_id, bank_account_id
  external_reference          -- gateway/bank transaction id
  idempotency_key UNIQUE      -- ← duplicate-payment guard
  status enum(PENDING, SETTLED, FAILED, REVERSED)
  journal_entry_id

payment_allocation
  id, payment_id, invoice_id, amount_minor, allocated_at, allocated_by
  -- append-only. Reallocation = a reversing allocation + a new one.

patient_deposit                 -- [Not Found] in the reference project
  id, patient_id, amount_minor, held_in_account_id,
  applied_minor, refunded_minor, status

cashier_shift                   -- reference: POS Opening/Closing Entry
  id, branch_id, cashier_id, opened_at, closed_at,
  opening_float_minor, expected_minor, counted_minor, variance_minor,
  variance_journal_entry_id     -- variance IS posted, unlike the reference
```

**[Recommended]** Three additions:

1. **Idempotency on every payment**, and gateway callbacks deduplicated on
   `external_reference` with a unique constraint. **[Not Found]** the reference project has
   `validate_transaction_reference` but no idempotency guarantee.
2. **Patient deposits as a first-class concept.** Money taken before treatment sits in a
   liability account (`PATIENT_DEPOSIT`) and is applied to charges later. The reference project
   has generic advances but **[Not Found]** no healthcare wiring.
3. **Cash variance is posted.** A counted-vs-expected difference posts to a cash-variance
   account. **[Confirmed]** the reference project's POS Closing Entry posts **nothing** — its
   `difference` field is computed in the browser (`pos_closing_entry.js:105`), is never read by any
   Python code, and no validation compares counted with expected, so its ledger tracks *expected*
   rather than *counted* cash.

**[Recommended]** Allocation is append-only. A misallocated payment is corrected by a
reversing allocation plus a new one — never by an `UPDATE`. **[Confirmed]** the reference
project does `UPDATE tabGL Entry SET against_voucher = null` in
`unlink_ref_doc_from_payment_entries` (`accounts/utils.py:513`),
destroying the allocation history.

---

## 7. M7 — Revenue Integrity

**[Recommended]** A module the reference project has no equivalent of, and the cheapest
insurance against the whole class of silent-revenue-loss bugs found in Layer 1.

Scheduled jobs, each producing an actionable work queue rather than a log line:

| Job | Detects | Reference project equivalent |
|---|---|---|
| **Unbilled charges** | `CAPTURED` charges older than N days | **[Not Found]** — services silently never billed |
| **Split imbalance** | Σ `charge_payer_split` ≠ `charge.net_minor` | **[Not Found]** |
| **Orphan clinical events** | a billable clinical event with no charge | **[Not Found]** — this is defect 1 and 6 inverted |
| **Zero-price charges** | `unit_price_minor = 0` on a chargeable service | **[Not Found]** — the reference project creates these silently |
| **Trial balance** | Σ debits ≠ Σ credits, all time | the reference project has an unreferenced `fix_total_debit_credit()` that would *silently adjust* the imbalance (`accounts/utils.py:573`) |
| **AR reconciliation** | Σ receivable accounts ≠ Σ open invoice balances | **[Not Found]** |
| **Stale claims** | claims `Pending` beyond the payer's SLA | **[Not Found]** |
| **Denials without disposition** | denied claims not routed to patient/appeal/write-off | **[Not Found]** — the reference project's `rejected_claims_account` is never read |
| **Deposit ageing** | unapplied patient deposits | **[Not Found]** |
| **Entitlement leakage** | entitlements consumed beyond `total_units` | **[Ambiguous]** in the reference project |

**[Recommended]** These jobs *detect and report*. They never auto-correct. Auto-correction is
how the reference project ended up with `fix_total_debit_credit`.

---

## 8. Dependency rules

**[Recommended]** Enforce in CI with an import-linter or equivalent:

| Rule | Rationale |
|---|---|
| M1 imports no other financial module | The accounting core must be testable alone. Violated in the reference project by the healthcare import into `sales_invoice.py`. |
| Clinical modules import no financial module | Coupling is one-way via events. |
| Only M1's `PostingService` writes ledger rows | The one-door rule. |
| No module reaches into another's tables | Cross-module reads go through a published interface. |
| No financial module imports a presentation layer | Calculation is server-side only; the reference project duplicates it in `.js`. |

---

## Open questions / unverified

1. **Panel/bundle billing** — whether a lab panel bills as one charge or one per component is
   a business decision (§2.6) that affects the payer split and the claim granularity.
2. **Package/membership products** — **[Not Found]** in the reference project. If the clinic
   sells prepaid packages, `entitlement` (§2.7) covers consumption but a package *sale* also
   needs deferred-revenue treatment. Not designed here.
3. **Whether corporate accounts are needed** is asserted from general clinic practice, not from
   the reference project. Validate before building M4's third payer type.
4. **No-show fees** (§2.6) are speculative; confirm the policy exists.
5. **Inventory/COGS integration** — `MedicationDispensed` is shown creating both a charge and
   an inventory posting, but the inventory module is not specified in this document set.
6. **Multi-branch semantics** — whether `branch_id` is a dimension within one legal entity or a
   separate entity changes M3's invoice numbering and M1's closing process.
7. The reference-project citations here are summaries of the Layer-1 documents. Read
   *../04-modules/healthcare-billing.md* and
   *../04-modules/healthcare-insurance.md* in full
   before implementing M4 and M6 — the detail matters.
