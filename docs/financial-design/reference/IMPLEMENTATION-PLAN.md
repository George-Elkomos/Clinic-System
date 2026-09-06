# Master Financial Implementation Plan — Clinic Management System

> **This is the entry point.** If you are about to build the financial subsystem of the Clinic
> Management System, read this document first, in full, before writing any code. It tells you
> what to build, why, in what order, what to read before each phase, and how to know when a
> phase is done.

**Purpose**
The execution roadmap and navigation hub for implementing the clinic system's financial
subsystem, derived from an exhaustive reverse-engineering of the ERPNext-Healthcare reference
project.

**Scope**
The complete financial subsystem: accounting core, charge capture, pricing, payers, billing,
AR, payments, reporting, security and integrity. Clinical functionality is out of scope except
where it emits financial events.

**Audience**
The developer or team implementing this. Assumes no prior knowledge of the reference project.

---

## Table of contents

- [0. What you are building, and why](#0-what-you-are-building-and-why)
- [1. Before you start — two decisions that change everything](#1-before-you-start--two-decisions-that-change-everything)
- [2. The target architecture in one picture](#2-the-target-architecture-in-one-picture)
- [3. Implementation strategy](#3-implementation-strategy)
- [4. Phase dependency graph](#4-phase-dependency-graph)
- [5. The phases](#5-the-phases) — [P0](#phase-0--foundations--decisions) · [P1](#phase-1--money) · [P2](#phase-2--chart-of-accounts--periods) · [P3](#phase-3--the-posting-engine) · [P4](#phase-4--service-catalogue--pricing) · [P5](#phase-5--payers--coverage) · [P6](#phase-6--charge-capture) · [P7](#phase-7--invoicing--ar) · [P8](#phase-8--payments--cash) · [P9](#phase-9--credits-refunds--adjustments) · [P10](#phase-10--claims--payer-settlement) · [P11](#phase-11--tax) · [P12](#phase-12--expenses--payables) · [P13](#phase-13--period-close--reporting) · [P14](#phase-14--security--audit) · [P15](#phase-15--integrations) · [P16](#phase-16--revenue-integrity--production-readiness)
- [6. Recommended master sequence](#6-recommended-master-sequence)
- [7. Where to find every specification](#7-where-to-find-every-specification)
- [8. The reference project's mistakes you are avoiding](#8-the-reference-projects-mistakes-you-are-avoiding)
- [9. Final blueprint](#9-final-blueprint)

---

## 0. What you are building, and why

### What
A double-entry financial subsystem for a clinic: an append-only general ledger, a chart of
accounts, charge capture from clinical events, multi-payer billing (patient, insurer,
corporate), receivables, payments and cash handling, claims and payer settlement, tax,
expenses, period close, financial reporting, and the controls that keep it all correct.

### Why it is built this way
The reference project — an ERPNext v13 fork with a Healthcare module — was reverse-engineered
in full. It gets the **accounting core** substantially right and the **clinical billing layer**
substantially wrong. This plan reuses the former and replaces the latter.

**Three findings shaped this entire plan.** Each is documented with source citations:

1. **The accounting core is sound and worth copying in design.** One ledger table, balances
   always derived, correction by reversal, a single 291-line posting choke point that enforces
   debits = credits. → *../03-accounting/accounting-model.md*

2. **Clinical billing state is a boolean flag, and that one choice causes seven defects** —
   including services re-billed indefinitely, a 24-hour inpatient stay billed as half a day, a
   non-atomic check-then-set on billing state, and cancelling *any* invoice freeing a clinical
   event. → *../04-modules/healthcare-billing.md*§7

3. **The insurance subsystem splits the receivable with a post-hoc journal entry that is never
   reversed, re-fires on invoice cancellation, and uses raw float arithmetic** — and a
   `Pending` or `Rejected` claim causes the delivered service to silently vanish from billing
   altogether. → *../04-modules/healthcare-insurance.md*§9

If you read only three Layer-1 documents, read those three.

### What "done" looks like
- Every clinical service delivered results in exactly one charge, billed to the right payer(s),
  at the right price, exactly once.
- Debits equal credits, exactly, for every entry, for all time — provable by a job.
- No posted entry is ever updated or deleted.
- Any figure in any report traces back through the ledger to the clinical act that caused it.
- A retried job, a duplicated webhook, or a double-clicked button cannot double-post.

---

## 1. Before you start — two decisions that change everything

**Answer both before Phase 0 ends.** Everything downstream depends on them.

### Decision A — Are you building on Frappe/ERPNext, or standalone?

| | On Frappe/ERPNext | Standalone |
|---|---|---|
| Integer money | Hard — `Currency` fieldtype is `decimal(21,9)` and `flt` is float-based | Straightforward |
| DB `CHECK` constraints | Not idiomatic; the framework owns DDL | Straightforward |
| `REVOKE UPDATE/DELETE` on the ledger | Fights the ORM | Straightforward |
| Real dimension columns | Possible, but the framework expects custom fields | Straightforward |
| Development speed | Much faster — you inherit permissions, reports, UI, workflow | Much slower |
| Reuse of the reference project | Direct — you could fork it | Design-level only |

**If you choose Frappe:** this plan still applies, but Phases 1–3 become *"constrain and wrap
what exists"* rather than *"build from scratch"*. Specifically: keep `decimal` money but
centralise every arithmetic operation in one `Money` helper that rounds explicitly; tighten
`round_off_debit_credit`'s `0.5` tolerance to one minor unit; add an idempotency-key field with
a unique index; disable `Accounts Settings.delete_linked_ledger_entries`; and reduce
`allow_on_submit` on financial doctypes. The clinical layer (Phases 4–10) should still be built
new — that is where the reference project's real problems are.

**This plan is written assuming standalone.** Deviations for Frappe are flagged where they
matter.

### Decision B — What is the organisational shape?

- Is a **branch** a cost centre within one legal entity, or a separate entity with its own
  trial balance? This changes the chart of accounts, invoice numbering, and period close.
- Is **multi-currency** needed? If not, do not build the dual-amount ledger columns — it is a
  large simplification. → [clinic-accounting-model.md](clinic-accounting-model.md)§2.3
- Which **payer types** actually exist? Self-pay and insurer are certain; corporate/third-party
  accounts are common but **[Not Found]** in the reference project, so validate the requirement.

---

## 2. The target architecture in one picture

```
 ┌───────────────────────────────────────────────────────────────────────────┐
 │  CLINICAL MODULES — emit events, import nothing financial                 │
 │  Scheduling · Encounters · Orders · Lab · Imaging · Pharmacy · Inpatient  │
 └────────────────────────────────┬──────────────────────────────────────────┘
                                  │  domain events (ONE-WAY)
                                  ▼
 ┌───────────────────────────────────────────────────────────────────────────┐
 │  M6 CHARGE CAPTURE          ← the pivot of the whole design               │
 │  Charge (priced at service time) + PayerSplit (computed once, stored)     │
 └──────────┬────────────────────────────────────────────┬───────────────────┘
            │                                            │
    ┌───────▼────────┐  ┌──────────────────┐    ┌────────▼─────────────────┐
    │ M5 PRICING     │  │ M4 PAYER          │    │ M7 REVENUE INTEGRITY    │
    │ catalogue      │  │ self-pay/insurer/ │    │ detect · alert · never  │
    │ tariffs        │  │ corporate         │    │ auto-correct            │
    │ discounts      │  │ coverage · copay  │    │                         │
    │ time-versioned │  │ deductible · cap  │    │                         │
    └───────┬────────┘  └────────┬──────────┘    └─────────────────────────┘
            │                    │
            └─────────┬──────────┘
                      ▼
 ┌───────────────────────────────────────────────────────────────────────────┐
 │  M3 BILLING & AR      one invoice per PAYER · claims · statements         │
 └────────────────────────────────┬──────────────────────────────────────────┘
                                  ▼
 ┌───────────────────────────────────────────────────────────────────────────┐
 │  M2 CASH & PAYMENTS   payment · allocation (append-only) · deposits ·     │
 │                       refunds · cashier shifts · gateways                 │
 └────────────────────────────────┬──────────────────────────────────────────┘
                                  ▼
 ┌───────────────────────────────────────────────────────────────────────────┐
 │  M1 ACCOUNTING CORE                                                       │
 │  Money(int minor units) · Account · Period                                │
 │  PostingService — THE ONE DOOR — idempotent, exact-balance, append-only   │
 │  ╔═══════════════════════════════════════════════════════════════════╗   │
 │  ║  journal_entry / journal_line   — append-only, DB-enforced         ║   │
 │  ╚═══════════════════════════════════════════════════════════════════╝   │
 └────────────────────────────────┬──────────────────────────────────────────┘
                                  ▼
 ┌───────────────────────────────────────────────────────────────────────────┐
 │  READ MODELS & REPORTING   derived only · trial balance · P&L · BS ·      │
 │  cash flow · AR ageing by payer · clinic KPIs                            │
 └───────────────────────────────────────────────────────────────────────────┘
                                  ▲
 ┌────────────────────────────────┴──────────────────────────────────────────┐
 │  CROSS-CUTTING   permissions · approvals · append-only audit log ·        │
 │                  reason codes · idempotency · integrity jobs             │
 └───────────────────────────────────────────────────────────────────────────┘
```

Detail: [implementation-blueprint.md](implementation-blueprint.md)

---

## 3. Implementation strategy

**[Recommended]** Five rules for how to work through the phases.

1. **Bottom-up, ledger first.** The accounting core must be complete and provable before any
   billing concept exists. If you build invoicing first you will bake its assumptions into the
   ledger. The reference project's shape — a small, disciplined posting engine under very large
   documents — is the model to aim for.

2. **The accounting core must be testable with no clinical concept present.** If M1's tests need
   a Patient, the boundary has leaked. This is the single best structural check available.

3. **Tests are part of the phase, not a later phase.** Each phase below lists the tests required
   for it to be considered done. The reference project's healthcare billing and insurance
   subsystems have **[Not Found]** *no automated tests at all* — and that is precisely where its
   defects are. → *../10-testing/coverage-gaps.md*

4. **Walking skeleton after Phase 8.** Phases 1–8 give you: a service is rendered → a charge is
   captured → an invoice is issued → a payment is received → the ledger balances → the trial
   balance proves it. Demonstrate that end-to-end before adding claims, tax, or expenses.

5. **Every phase ends with the integrity job green.** Add each invariant's check to the job as
   you implement the invariant, and run it in CI.

---

## 4. Phase dependency graph

```
  P0 Foundations & decisions
        │
        ▼
  P1 Money  ◄────────────────── everything depends on this
        │
        ▼
  P2 Chart of accounts & periods
        │
        ▼
  P3 POSTING ENGINE  ◄───────── the keystone; nothing posts without it
        │
        ├──────────────┬──────────────┐
        ▼              ▼              ▼
  P4 Pricing     P11 Tax        P12 Expenses/AP
        │         (needs P3)      (needs P3, P8)
        ▼
  P5 Payers & coverage
        │
        ▼
  P6 CHARGE CAPTURE  ◄────────── the clinical pivot
        │
        ▼
  P7 Invoicing & AR
        │
        ▼
  P8 Payments & cash  ─────────► ◆ WALKING SKELETON COMPLETE
        │
        ├──────────────┬──────────────┐
        ▼              ▼              ▼
  P9 Credits/     P10 Claims &   P13 Period close
     refunds          settlement      & reporting
        │              │              │
        └──────────────┴──────────────┘
                       │
        ┌──────────────┴──────────────┐
        ▼                             ▼
  P14 Security & audit          P15 Integrations
        │                             │
        └──────────────┬──────────────┘
                       ▼
       P16 Revenue integrity & production readiness
```

**Hard dependencies** (cannot start before): P1→P2→P3; P3→everything that posts; P4→P6;
P5→P6; P6→P7; P7→P8; P7+P5→P10.

**Soft dependencies** (better after, but can proceed): P11 Tax can be stubbed as zero-tax
until P7 exists; P13 reporting can begin as soon as P3 lands; P14 should be designed in P0 and
enforced progressively.

**Parallelisable:**
- P4 Pricing ∥ P5 Payers (different developers, meet at P6)
- P11 Tax ∥ P12 Expenses ∥ P13 Reporting (all only need P3)
- P14 Security ∥ P15 Integrations
- Read models for reporting can be built alongside any phase from P3 onward.

**Blocking components** — a delay here stalls everything: `Money` (P1), `PostingService` (P3),
`Charge` (P6).

---

## 5. The phases

Each phase states: objective, why it exists, prerequisites, required reading, components,
implementation order, outputs, risks, and definition of done.

---

### Phase 0 — Foundations & decisions

**Objective.** Resolve the platform and organisational-shape decisions, agree the invariants,
and set up the project so that financial correctness is enforceable in CI.

**Why this phase exists.** Decisions A and B (§1) are irreversible in practice. The reference
project's biggest structural problems — float money, mutable posted rows, no idempotency — are
all consequences of early decisions that were never revisited.

**Prerequisites.** None.

**Required reading.**
1. *../01-overview/system-financial-overview.md*
2. *../01-overview/financial-glossary.md* — keep open throughout
3. *../01-overview/financial-domain-map.md*
4. [reusable-financial-architecture.md](reusable-financial-architecture.md) — the reuse/adapt decisions
5. *../11-analysis/risks.md* — what you are avoiding

**Components to implement.**
- A written decision record for A and B (§1).
- The invariant list (I1–I14) from [clinic-accounting-model.md](clinic-accounting-model.md)§8,
  agreed and committed to the repository.
- Project skeleton: module directories matching M1–M7, with an import-linter rule enforcing the
  dependency rules in [clinic-financial-modules.md](clinic-financial-modules.md)§8.
- CI: test runner, migration runner, an `integrity-check` command (initially empty).
- The rounding policy, written down in one file.

**Implementation order.** Decisions → invariants → skeleton → CI → import-linter.

**Expected outputs.** A repository where a dependency violation fails the build, and a document
stating the money type, the platform, the branch model, and the currency model.

**Risks.** Skipping the decision record and discovering in Phase 7 that branches need separate
trial balances. Choosing Frappe without recognising that integer money then becomes infeasible.

**Definition of done.**
- [ ] Platform decision recorded with rationale
- [ ] Branch/entity model recorded
- [ ] Multi-currency decision recorded
- [ ] Payer types confirmed with the business
- [ ] Invariants I1–I14 committed
- [ ] Import-linter rules in CI and failing on a deliberate violation
- [ ] `integrity-check` command exists and runs (even with no checks yet)
- [ ] Rounding policy documented

---

### Phase 1 — Money

**Objective.** A `Money` value object over integer minor units, with deterministic allocation.

**Why this phase exists.** This is the fix for the reference project's most pervasive flaw.
**[Confirmed]** it stores amounts as `decimal(21,9)` but computes in Python `float`; the
healthcare insurance code uses the built-in `float()` and the literal `0.01` with no precision
control (*../04-modules/healthcare-insurance.md*§9.3).
The downstream consequence is the ledger's `0.5` imbalance tolerance for most voucher types
(*../03-accounting/accounting-model.md*). Get money right
and that tolerance becomes unnecessary.

**Prerequisites.** P0.

**Required reading.**
1. *../03-accounting/currency-and-rounding.md* — *(if not yet written, read *../04-modules/taxes.md* for the rounding pipeline)*
2. [clinic-accounting-model.md](clinic-accounting-model.md)§2
3. *../11-analysis/weaknesses.md* — the money-arithmetic finding

**Components to implement.**
- `Currency` (ISO-4217 code + exponent: EGP=2, JPY=0, KWD=3).
- `Money` value object: `amount_minor: int64`, `currency`.
- Operations: `+`, `-` (same currency only, else raise); `*` by int/Decimal with an explicit
  rounding mode; comparison; zero/negative predicates.
- **`allocate(ratios) -> [Money]`** — distributes a total so that `Σ parts == whole` exactly.
- Parsing/formatting from and to strings and minor units. **No float constructor at all.**
- Serialisation for the DB (`BIGINT` + `CHAR(3)`) and for the API.
- If multi-currency: `ExchangeRate` with the rate stored on the transaction, never re-looked-up.

**Implementation order.**
1. `Currency` with the exponent table
2. `Money` construction and equality
3. Addition/subtraction with currency guards
4. Multiplication with explicit rounding
5. `allocate` — hardest part; write the property test first
6. Persistence mapping
7. Formatting/parsing
8. Exchange rate (only if Decision B says multi-currency)

**Expected outputs.** A module with no dependencies that no other code can bypass — grep for
`float` in financial code should return nothing.

**Risks.** Allowing a float constructor "just for tests" — it will reach production. Using
`Decimal` without a documented scale and rounding mode, which reproduces the reference
project's ambiguity in a new form.

**Definition of done.**
- [ ] `Money` has no code path accepting a float
- [ ] Cross-currency arithmetic raises
- [ ] **Property test: for any total and any ratios, `Σ allocate(ratios) == total`** (invariant I13)
- [ ] Property test: `(a + b) - b == a` for random values
- [ ] Rounding mode is explicit at every call site; no implicit rounding exists
- [ ] Round-trip test: DB → object → DB is lossless
- [ ] A lint rule forbids `float` in financial modules

---

### Phase 2 — Chart of accounts & periods

**Objective.** The account tree with behavioural typing, and the fiscal year/period model.

**Why this phase exists.** Posting cannot validate an account it cannot look up. The reference
project's account model is good and is largely adopted; its *period* model is three overlapping
mechanisms and is simplified.

**Prerequisites.** P1.

**Required reading.**
1. *../03-accounting/chart-of-accounts.md* — the reference account model and every `account_type`
2. *../03-accounting/financial-periods.md* — fiscal years, periods, freezing, closing
3. [clinic-chart-of-accounts.md](clinic-chart-of-accounts.md) — **the clinic-specific tree**
4. [clinic-accounting-model.md](clinic-accounting-model.md)§4, §7

**Components to implement.**
- `Account`: code (immutable once referenced), name, parent, `path`, `is_group`, `root_type`,
  `account_type`, `currency`, `normal_balance`, `is_active`.
- Tree operations: subtree query, ancestor path, cycle prevention, "only leaves are postable".
- `account_type` enum — at minimum the list in [clinic-accounting-model.md](clinic-accounting-model.md)§4,
  including `CONTRACTUAL_ADJUSTMENT` and `PATIENT_DEPOSIT`, both **[Not Found]** in the reference project.
- `FiscalYear` and `Period` with `OPEN` / `SOFT_CLOSED` / `CLOSED`.
- `clinic.ledger_locked_upto`.
- **`ClinicAccountMap`** — the named account for every purpose (patient AR, insurer AR,
  corporate AR, each revenue line, discount, contractual adjustment, write-off, round-off,
  patient deposits, cash, bank, tax) **with a completeness validator run at setup**.
- Seed data: the default clinic chart of accounts.
- Dimensions as real tables: `Branch`, `Department`, `CostCenter`, and the practitioner link.

**Implementation order.**
1. `Account` entity + tree invariants
2. `root_type` → `normal_balance` derivation
3. `account_type` enum and lookup helpers (`account_for(purpose)`)
4. `FiscalYear` / `Period` with non-overlap validation
5. Dimension tables
6. `ClinicAccountMap` + completeness validator
7. Seed the default chart
8. Immutability guard on `code`

**Expected outputs.** A seeded, validated chart of accounts; a period calendar; and a resolver
that answers "which account for this purpose in this clinic?" without hard-coded codes.

**Risks.** Copying the reference project's per-practitioner *income accounts* instead of using a
practitioner *dimension* — this pollutes the chart with one account per doctor
(*../04-modules/healthcare-configuration.md*§3).
Allowing account codes to change after use, as the reference project does.

**Definition of done.**
- [ ] Account tree enforces: no cycles, no posting to a group, no cross-clinic parent
- [ ] `code` immutability enforced and tested
- [ ] `normal_balance` derived from `root_type` and tested for all five root types
- [ ] Overlapping fiscal years and periods rejected
- [ ] `ClinicAccountMap` completeness validator fails loudly on an incomplete map
- [ ] Default chart seeds cleanly and every `account_type` needed by later phases is present
- [ ] Practitioner and department are **dimensions**, not accounts

---

### Phase 3 — The posting engine

**Objective.** `PostingService.post(draft)` — the one door to the ledger, idempotent and
exactly balancing.

**Why this phase exists.** **The keystone.** Everything else in the system is a caller of this
function. The reference project's engine is only 291 lines and is the best part of it — but it
tolerates a `0.5` imbalance on most voucher types, has no idempotency key, and its ledger is
mutated by four raw-SQL sites.

**Prerequisites.** P1, P2.

**Required reading.**
1. ***../03-accounting/accounting-model.md*** — read in full; this is the engine you are improving on
2. *../03-accounting/posting-rules.md* — the pipeline and every caller
3. *../03-accounting/debit-credit-rules.md*
4. *../02-architecture/module-boundaries.md*§3.2 — **the four raw-SQL ledger-mutation sites you must not reproduce**
5. *../02-architecture/transactions-and-consistency.md*
6. [clinic-accounting-model.md](clinic-accounting-model.md)§3, §5, §6, §8

**Components to implement.**
- `journal_entry` / `journal_line` schema per [clinic-accounting-model.md](clinic-accounting-model.md)§3.1,
  including `idempotency_key UNIQUE`, `reverses_entry_id`, `entry_no`, and the
  `CHECK ((debit=0) <> (credit=0))` constraint.
- **DB-enforced append-only**: revoke UPDATE/DELETE plus a raising trigger.
- `PostingService.post(draft)` with the 11-step pipeline
  ([clinic-accounting-model.md](clinic-accounting-model.md)§5).
- `ReversalService.reverse(entry_id, reason_code, posting_date?)`.
- `BalanceService`: `balance(account, as_of, dimensions)`, `trial_balance(as_of)`,
  `party_balance(party_type, party_id, as_of)`.
- Idempotency key builder.
- `JournalEntryPosted` domain event (for read models only — **never** to trigger more posting).
- Integrity checks I1, I2, I3, I4, I9 wired into `integrity-check`.

**Implementation order.**
1. Schema + constraints + append-only enforcement (do this *first* — it constrains everything after)
2. `JournalEntryDraft` and `JournalLineDraft` types
3. Pipeline steps 2–7 (structure, balance, currency, accounts, party, dimensions) — pure validation, easy to test
4. Period resolution and lock-date check (steps 8–9)
5. Persistence in one transaction (step 10)
6. Idempotency (step 1) — **last of the pipeline, because the tests need everything else working**
7. `ReversalService`
8. `BalanceService`
9. Integrity checks
10. Domain event emission

**Expected outputs.** A ledger you cannot corrupt: no unbalanced entry, no duplicate post, no
update, no delete, no posting into a closed period. **Testable with zero clinical or billing
concepts present.**

**Risks.**
- Adding a tolerance "temporarily" because a test won't balance. The test is telling you the
  arithmetic is wrong; fix the arithmetic.
- Emitting an event that triggers further posting — the reference project's insurance claim
  posts a Journal Entry from `on_update_after_submit`, which is exactly this mistake and is why
  it double-posts (*../04-modules/healthcare-insurance.md*§9.2).
- Letting any other code insert a ledger row.

**Definition of done.**
- [ ] I1: exact balance enforced — **no tolerance** (property test over random entries)
- [ ] I3: UPDATE and DELETE on ledger tables raise (test asserts it)
- [ ] I4: one-side-only `CHECK` enforced (test asserts insert fails)
- [ ] I5: party required on receivable/payable, forbidden elsewhere
- [ ] I6: cost centre + branch required on all P&L lines
- [ ] I7: **concurrency test — two threads, same idempotency key → one entry** ⚠ critical
- [ ] I8: posting into a `CLOSED` period rejected
- [ ] I11: reversal mirrors the original exactly; reversal-of-reversal restores
- [ ] I14: mixed currency within an entry rejected
- [ ] Partial-failure test: a failure on line 5 of 6 leaves **no** rows
- [ ] `trial_balance()` sums to zero across a large random dataset
- [ ] `integrity-check` runs I1, I2, I3, I4, I9 and is green in CI
- [ ] **The entire M1 test suite passes with no Patient, Charge, Invoice or Payment class in existence**

---

### Phase 4 — Service catalogue & pricing

**Objective.** Every billable service, and a price resolver that raises rather than returning zero.

**Why this phase exists.** Charge capture needs a price. **[Confirmed]** the reference project
returns `0.0` when no `Item Price` exists — silently billing nothing for delivered care
(*../04-modules/healthcare-insurance.md*§4,
*../04-modules/healthcare-billing.md*§7.7).

**Prerequisites.** P1, P2. *(Parallel with P5.)*

**Required reading.**
1. *../04-modules/billing-and-pricing.md* — price lists, pricing rules, discounts
2. *../04-modules/healthcare-configuration.md*§4–5 — how the reference project prices clinical services
3. [clinic-financial-modules.md](clinic-financial-modules.md)§3

**Components to implement.**
- `Service`: code, name, category, `revenue_account_id`, `default_cost_center_id`, `taxable`,
  `tax_group_id`, `is_active`.
- `ServiceCategory` — the revenue-line grouping (consultation, laboratory, imaging, pharmacy,
  procedure, inpatient, other).
- `PriceList` with `kind` ∈ {CASH, PAYER_TARIFF, CORPORATE, INTERNAL} and validity dates.
- `ServicePrice`: **time-versioned** (`valid_from`/`valid_to`), never overwritten.
- `DiscountPolicy` with `requires_approval_above` and **its own revenue account**.
- `PricingService.resolve(service, payer, service_date) -> Money` — **raises** `PriceNotFound`.
- Occupancy/time-based pricing: `unit_hours`, and the corrected `occupancy_units()` function
  from [clinic-financial-modules.md](clinic-financial-modules.md)§2.5.

**Implementation order.**
1. `Service` + `ServiceCategory` + revenue-account binding
2. `PriceList`
3. `ServicePrice` with temporal validity
4. `PricingService.resolve` — cascade: payer tariff → clinic cash list → raise
5. `DiscountPolicy` and approval thresholds
6. `occupancy_units()` **with its full boundary test table**

**Expected outputs.** A catalogue where every active service has a resolvable price for every
active payer, verified by a test that iterates the whole matrix.

**Risks.** Reproducing the silent zero. Resolving prices by *today's* date instead of the
service date — the reference project's coverage lookup does exactly this
(*../04-modules/healthcare-insurance.md*§3.1).

**Definition of done.**
- [ ] `resolve()` **raises** on a missing price — asserted by test
- [ ] Price resolution uses `service_date`, tested with a back-dated case
- [ ] Overlapping `ServicePrice` validity windows rejected
- [ ] Every active service resolves for every active payer (matrix test)
- [ ] **`occupancy_units()` passes the full boundary table, including 24h→1.0, 36h→1.5, 48h→2.0** ⚠ the reference project fails all three
- [ ] Discounts carry their own account
- [ ] Changing a price does not alter any historical charge (test)

---

### Phase 5 — Payers & coverage

**Objective.** Self-pay, insurer and corporate payers; coverage rules; copay, deductible and cap
accumulators; the split calculator.

**Why this phase exists.** The largest single adaptation. The reference project's insurance
subsystem has the right *concepts* and a defective *implementation*, and is missing copay,
deductible, caps, pre-authorisation and denial management entirely.

**Prerequisites.** P1, P2. *(Parallel with P4; both meet at P6.)*

**Required reading.**
1. ***../04-modules/healthcare-insurance.md*** — read in full, especially §6 (the AR-transfer JE), §8 (silent revenue loss on non-approved claims) and §9 (all nine defects)
2. *../06-workflows/insurance-claim-workflow.md*
3. [clinic-financial-modules.md](clinic-financial-modules.md)§4
4. [reusable-financial-architecture.md](reusable-financial-architecture.md)§3

**Components to implement.**
- `Payer` (polymorphic: `SelfPay`, `Insurer`, `CorporateAccount`), each with its **own
  receivable control account** — the one insurance idea worth copying directly.
- `PayerContract` with validity window, and `PayerPlan`.
- `PatientCoverage` — the patient's enrolment, with **`valid_from` and `valid_to` both
  enforced** (the reference project has no start date and does not enforce the end date).
- `CoverageRule`: match by service / category / code; `coverage_pct`, `copay_fixed_minor`,
  `copay_pct`, `excluded`, `requires_preauth`, validity — **`valid_to` actually applied at
  lookup**.
- `BenefitAccumulator`: per patient, per plan, per benefit year — `deductible_met_minor`,
  `out_of_pocket_minor`, `benefit_used_minor`.
- `PreAuthorization`.
- **`SplitCalculator.split(charge, coverage, accumulators) -> [PayerSplit]`** implementing the
  ordered algorithm in [clinic-financial-modules.md](clinic-financial-modules.md)§4, with the
  post-condition `Σ splits == charge.net_minor`.

**Implementation order.**
1. `Payer` hierarchy + receivable account binding
2. `PayerContract` / `PayerPlan`
3. `PatientCoverage` with enforced validity
4. `CoverageRule` + the resolution cascade (service → category → code), **evaluated at service date**
5. `BenefitAccumulator` (needs concurrency care — two charges in flight against one deductible)
6. `PreAuthorization`
7. **`SplitCalculator`** — the hardest single piece in the system; write the test table first

**Expected outputs.** Given a charge and a patient's coverage, a deterministic, exactly-summing
split across payers with an explicit `basis` for every component.

**Risks.**
- Recomputing the split later instead of storing it. **[Confirmed]** the reference project
  re-reads coverage at invoicing time from the *current* rules, so a coverage change re-prices
  delivered care.
- Deductible accumulator races producing over- or under-collection. Needs a lock or an
  optimistic-concurrency retry.
- Losing a minor unit in the split — use `Money.allocate`.

**Definition of done.**
- [ ] **`Σ splits == charge.net_minor` — property test over random charges and coverages** ⚠ invariant
- [ ] Coverage resolved by **service date**, not today (test with back-dated service)
- [ ] `valid_to` on coverage rules **is** enforced (test with an expired rule)
- [ ] Expired `PatientCoverage` → 100% self-pay, never an error and never dropped
- [ ] Excluded service → 100% self-pay with `basis = EXCLUSION`
- [ ] Copay (fixed and %), deductible, and annual cap each have a dedicated test
- [ ] Coverage exceeding the service rate cannot produce a negative self-pay amount
- [ ] Missing pre-auth where required → self-pay + flagged, **not** dropped
- [ ] Deductible accumulator concurrency test (two parallel charges)
- [ ] Contractual adjustment computed and given its own basis

---

### Phase 6 — Charge capture

**Objective.** Clinical events become `Charge` records with stored payer splits. **The pivot of
the whole design.**

**Why this phase exists.** This phase is where the reference project's seven billing defects are
structurally eliminated. Read
*../04-modules/healthcare-billing.md*§7 and
[clinic-financial-modules.md](clinic-financial-modules.md)§2.3 side by side before starting.

**Prerequisites.** P3, P4, P5.

**Required reading.**
1. ***../04-modules/healthcare-billing.md*** — read in full; §1.1 (the ten collectors), §3 (the occupancy bug), §4 (`set_invoiced`), §7 (all seven defects)
2. *../06-workflows/healthcare-billing-workflow.md*
3. [clinic-financial-modules.md](clinic-financial-modules.md)§2 — **the target design**
4. [clinic-data-model.md](clinic-data-model.md)

**Components to implement.**
- `Charge` + `ChargePayerSplit` per [clinic-financial-modules.md](clinic-financial-modules.md)§2.2,
  including **`UNIQUE (source_type, source_id, service_id)`** and
  **`ChargePayerSplit.invoice_line_id UNIQUE`**.
- `charge_status_history` — append-only.
- `ChargeService.capture(event) -> Charge` — resolves price, computes split, stores both.
- `ChargeService.void(charge, reason)` and `.write_off(charge, reason)` — distinct operations.
- One **idempotent** event handler per clinical event type
  ([clinic-financial-modules.md](clinic-financial-modules.md)§2.6).
- `Entitlement` + `EntitlementConsumption` — replacing Fee Validity
  ([clinic-financial-modules.md](clinic-financial-modules.md)§2.7).
- Integrity check I12 and the split-sum check.

**Implementation order.**
1. `Charge` schema with **both unique constraints** — first, so nothing can be built around their absence
2. `ChargePayerSplit`
3. `ChargeService.capture` (price → split → persist, in one transaction)
4. The status machine + `charge_status_history`
5. `void` / `write_off`
6. Event handlers, one clinical event at a time — start with consultation, the simplest
7. Occupancy handler (uses P4's `occupancy_units`) — **only fires on discharge/transfer**
8. `Entitlement` and its consumption
9. Integrity checks

**Expected outputs.** Every billable clinical act produces exactly one charge, priced at the
service date, split across payers, with a full audit trail — and re-delivering the event changes
nothing.

**Risks.**
- Making charge creation a query ("find unbilled things") instead of an event handler. That is
  the reference project's design and the direct cause of defects 1 and 6.
- Creating an occupancy charge before discharge, when `check_out` is null.
- Forgetting that a free/entitled service still needs a `Charge` (at zero) so the delivered
  service remains visible.

**Definition of done.**
- [ ] `UNIQUE (source_type, source_id, service_id)` enforced — **duplicate event creates no second charge** ⚠ fixes defect 1
- [ ] **Concurrency test: two threads handling the same event → one charge** ⚠ fixes defect 4
- [ ] I12: a split is invoiced at most once, enforced by `UNIQUE` (concurrency test) ⚠ fixes defect 5
- [ ] Split sum == charge net, checked by the integrity job
- [ ] Price and accounts are captured at **service date** and never re-read
- [ ] Occupancy charge only on discharge/transfer; null `check_out` raises
- [ ] Occupancy quantity correct for 24h/36h/48h ⚠ fixes defect 2
- [ ] `VOID` and `WRITE_OFF` are distinct, both require a reason, both audited ⚠ fixes defect 3
- [ ] Draft clinical documents produce no charge ⚠ fixes defect 6
- [ ] A missing price raises, never bills zero ⚠ fixes defect 7
- [ ] Entitled service produces a zero-value charge with the entitlement recorded
- [ ] Every event handler is idempotent, tested by double delivery

---

### Phase 7 — Invoicing & AR

**Objective.** Group charges into per-payer invoices, post them, and expose receivables.

**Prerequisites.** P3, P6.

**Required reading.**
1. ***../04-modules/invoicing.md***§4 — the reference project's complete GL entry table; this is the posting behaviour to reproduce correctly
2. *../06-workflows/invoice-workflow.md*
3. *../04-modules/receivables-and-reconciliation.md* — outstanding lifecycle, ageing
4. [clinic-accounting-events.md](clinic-accounting-events.md) — **the exact entries to post**
5. [clinic-financial-modules.md](clinic-financial-modules.md)§5

**Components to implement.**
- `Invoice` + `InvoiceLine` with `charge_split_id UNIQUE`.
- Gapless, immutable invoice numbering per series per clinic.
- `InvoiceService.create_from_charges(payer, charges)`, `.issue(invoice)` → posts via
  `PostingService`, `.cancel(invoice, reason)` → reverses.
- Status derived from allocations, not stored ad hoc.
- `PaymentTerms` / instalment schedule.
- **Derived** outstanding: `outstanding(invoice) = total − Σ allocations + Σ credits`.
- Read models: AR ageing **by payer type**, payer statement, patient statement.
- Integrity check I10.

**Implementation order.**
1. `Invoice` / `InvoiceLine` schema + numbering
2. `create_from_charges` (charge → line, split → payer)
3. `issue` → build the draft entry → `PostingService.post`
4. Charge status transition to `INVOICED`, inside the same transaction
5. `cancel` → reverse the entry, charges back to `CAPTURED`
6. Derived outstanding + status
7. Payment terms and due dates
8. Ageing and statement read models
9. I10 reconciliation check

**Risks.** Denormalising `outstanding` as a mutable column — the reference project's largest
consistency risk. Mutable invoice numbers.

**Definition of done.**
- [ ] One invoice per payer; an insured encounter produces patient and insurer invoices
- [ ] Invoice numbers gapless and immutable; a cancelled invoice does not reuse its number
- [ ] Issue posts exactly one balanced entry with the correct revenue, discount, contractual-adjustment and receivable lines
- [ ] Cancel reverses exactly and returns charges to `CAPTURED`
- [ ] A charge split cannot appear on two invoices (concurrency test)
- [ ] `outstanding` is derived; no mutable column exists
- [ ] I10: Σ receivable control accounts == Σ open invoice balances (integrity job)
- [ ] Zero-value invoice handled (entitled services) without an unbalanced entry
- [ ] Ageing report ties to the trial balance

---

### Phase 8 — Payments & cash

**Objective.** Receive money, allocate it, handle deposits, and reconcile the till.
**◆ Walking skeleton completes here.**

**Prerequisites.** P3, P7.

**Required reading.**
1. ***../04-modules/payments.md*** — the Payment Entry GL table and the payment/allocation model
2. *../06-workflows/payment-workflow.md*
3. *../04-modules/pos-and-cash.md* — cashier shifts
4. [clinic-financial-modules.md](clinic-financial-modules.md)§6
5. [clinic-accounting-events.md](clinic-accounting-events.md)

**Components to implement.**
- `Payment` with `idempotency_key UNIQUE` and `external_reference UNIQUE`.
- `PaymentAllocation` — **append-only**; reallocation is a reversal plus a new allocation.
- `PatientDeposit` held in a `PATIENT_DEPOSIT` liability account.
- `CashierShift` with opening float, expected, counted, and a **posted** variance.
- Payment methods; bank accounts; a gateway adapter interface.
- `Refund`.

**Implementation order.**
1. `Payment` + idempotency
2. `PostingService` call for receipt (Dr cash/bank, Cr receivable)
3. `PaymentAllocation` append-only, with the derived-outstanding recalculation
4. Over-payment → deposit/advance
5. `PatientDeposit` and its application to charges
6. `CashierShift` open/close with variance posting
7. Refund path
8. Gateway adapter + webhook deduplication

**Risks.** Duplicate payments from gateway webhook replay. Mutating allocations instead of
reversing them.

**Definition of done.**
- [ ] **Duplicate payment with the same idempotency key → one payment, one entry** ⚠
- [ ] Replayed gateway webhook creates nothing new (test)
- [ ] Part payment, exact payment, over-payment (→ deposit) each tested
- [ ] Allocation is append-only; reallocation leaves both records visible
- [ ] Deposit application posts correctly and the liability clears
- [ ] Cashier shift variance is **posted**, not just recorded
- [ ] Refund reverses correctly and cannot exceed what was received
- [ ] **◆ END-TO-END: service → charge → invoice → payment → trial balance sums to zero**

---

### Phase 9 — Credits, refunds & adjustments

**Objective.** Correct billing errors without ever mutating a posted entry.

**Prerequisites.** P7, P8.

**Required reading.**
1. *../04-modules/refunds-and-credit-notes.md*
2. *../03-accounting/reversals-and-adjustments.md*
3. *../06-workflows/refund-workflow.md*
4. [clinic-accounting-model.md](clinic-accounting-model.md)§6

**Components to implement.**
- `CreditNote` (full and partial) linked to its invoice.
- `WriteOff` with approval above a threshold.
- `ContractualAdjustment` as an explicit, accounted event — **[Not Found]** in the reference project.
- Reason-code taxonomy, mandatory on every correction.
- Approval workflow for corrections above configured limits.

**Definition of done.**
- [ ] Full and partial credit notes post correctly and adjust outstanding
- [ ] Credit note after full payment produces a refundable balance
- [ ] Write-off requires approval above the threshold and posts to `WRITE_OFF`
- [ ] Contractual adjustment has its own account and is reportable
- [ ] Every correction carries a reason code (DB-enforced)
- [ ] Correction into a closed period posts to the current period with `original_posting_date` recorded
- [ ] No correction path updates or deletes a posted entry

---

### Phase 10 — Claims & payer settlement

**Objective.** Submit, track, adjudicate and settle payer claims — including denials.

**Prerequisites.** P5, P7.

**Required reading.**
1. ***../04-modules/healthcare-insurance.md***§5, §7, §9 — the claim state machine and every defect
2. *../06-workflows/insurance-claim-workflow.md*
3. [clinic-financial-modules.md](clinic-financial-modules.md)§4

**Components to implement.**
- `Claim` per charge split; `ClaimBatch`; `Remittance` with per-claim allocation and variance.
- Claim state machine with **every state declared** — the reference project writes
  `'Payment Requested'` and `'Payment Approved'`, neither of which is in its own Select options
  (*../04-modules/healthcare-insurance.md*§5).
- **Partial approval**: `approved_minor` ≠ `claimed_minor` → the shortfall becomes a
  contractual adjustment, a patient balance, or a write-off — an explicit decision, never nothing.
- **Denial management**: denial code → disposition (appeal / patient responsibility / write-off).
- Claim ageing and follow-up work queues.

**Risks.** Reproducing the reference project's silent-drop behaviour for non-approved claims.
Posting a corrective journal instead of relying on the split from P5.

**Definition of done.**
- [ ] Every claim state is declared and reachable; no undeclared status is ever written
- [ ] Partial approval routes the shortfall explicitly and posts it
- [ ] **A denied claim always has a disposition; it can never silently vanish** ⚠ fixes the reference project's worst behaviour
- [ ] Remittance allocates across claims and posts the variance
- [ ] Claim cancellation reverses cleanly — **and does not re-fire the posting** ⚠
- [ ] Insurer AR ties to the sum of open claims
- [ ] Claim ageing report exists

---

### Phase 11 — Tax

**Objective.** Correct tax on charges and invoices.

**Prerequisites.** P3. Integrate at P7. *(Parallelisable.)*

**Required reading.**
1. ***../04-modules/taxes.md*** — the five charge types, inclusive-tax fraction maths, and the rounding pipeline. The *algorithm* here is worth reusing.
2. *../03-accounting/currency-and-rounding.md*

**Components to implement.** `TaxGroup`/`TaxRate` with temporal validity; per-line calculation;
inclusive and exclusive handling; exemptions (common for healthcare services); tax liability
posting and a tax report.

**Definition of done.**
- [ ] Exclusive and inclusive tax each tested against hand-computed figures
- [ ] Rounding applied **once**, at line level, per the documented policy
- [ ] Tax-exempt services produce no tax line
- [ ] Tax on a credit note reverses proportionally
- [ ] Tax liability account ties to the tax report

---

### Phase 12 — Expenses & payables

**Objective.** The purchase side: supplier invoices, payments, and clinic operating expenses.

**Prerequisites.** P3, P8. *(Parallelisable.)*

**Required reading.**
1. *../04-modules/payables-and-purchasing.md*
2. *../06-workflows/expense-workflow.md*
3. *../04-modules/inventory-and-asset-accounting.md* — if the clinic holds pharmacy or consumable stock

**Components to implement.** `Supplier`; `SupplierInvoice`; outgoing `Payment` reusing P8;
expense categories mapped to accounts; optionally inventory/COGS and fixed assets with
depreciation.

**Definition of done.**
- [ ] Supplier invoice posts Dr expense / Cr payable
- [ ] Supplier payment settles and ages correctly
- [ ] Duplicate supplier-invoice-number detection
- [ ] If stock: dispensing posts COGS and inventory ties to the ledger
- [ ] AP ageing ties to the trial balance

---

### Phase 13 — Period close & reporting

**Objective.** Month-end and year-end close, and the financial statement suite.

**Prerequisites.** P3 (start early), P7, P8.

**Required reading.**
1. *../09-reports/financial-statements.md* — the shared reporting engine; the *approach* is worth copying
2. *../03-accounting/financial-periods.md* — period closing voucher logic
3. *../09-reports/dashboards-and-metrics.md*

**Components to implement.** Period close with a pre-close checklist (unbilled charges, unposted
payments, unreconciled cash); year-end close to retained earnings, preserving dimension
breakdown; Trial Balance, P&L, Balance Sheet, Cash Flow, GL detail, AR/AP ageing by payer,
revenue by service line / department / practitioner / branch; clinic KPIs (revenue per
encounter, collection rate, days in AR, denial rate, contractual adjustment rate).

**Definition of done.**
- [ ] Trial balance sums to zero for every period
- [ ] Balance Sheet balances; P&L ties to the ledger
- [ ] Year-end close zeroes P&L to equity and preserves dimensions
- [ ] Closed periods reject posting
- [ ] Every report ties to the trial balance (automated cross-check test)
- [ ] Pre-close checklist blocks close on unresolved items

---

### Phase 14 — Security & audit

**Objective.** Enforce who may do what, and record everything that touches money.

**Prerequisites.** Designed in P0; enforced progressively; completed here.

**Required reading.**
1. *../08-security/permissions.md* — the reference role matrix
2. *../08-security/authorization.md* — **and every `ignore_permissions` bypass it lists**
3. *../08-security/audit.md*
4. *../01-overview/actors-and-roles.md*

**Components to implement.** Roles (Cashier, Billing Clerk, Billing Supervisor, Accountant,
Finance Manager, Auditor read-only, Clinician, Practitioner); permissions separating create /
issue / cancel / approve; approval workflows with thresholds; **enforced separation of duties**;
an append-only financial audit log; reason-code enforcement.

**Risks.** Reproducing the reference project's bypasses. **[Confirmed]** healthcare
auto-invoicing submits a Sales Invoice with both `ignore_permissions=True` **and**
`ignore_mandatory=True` (*../04-modules/healthcare-billing.md*§5),
and the insurance claim posts its journal entry with `ignore_permissions=True`.

**Definition of done.**
- [ ] No money-posting path bypasses permissions; background jobs use an audited service principal
- [ ] Separation of duties enforced: the payment creator cannot approve it
- [ ] Approval thresholds enforced for refunds, write-offs and manual entries
- [ ] Append-only audit log covers every money-affecting operation
- [ ] Auditor role can read everything and change nothing (test)
- [ ] Every correction has an attributable user and a reason
- [ ] A permission-bypass attempt is tested and fails

---

### Phase 15 — Integrations

**Objective.** Payment gateways, bank feeds, and payer connectivity — safely.

**Prerequisites.** P8, P10, P14.

**Required reading.**
1. *../02-architecture/integration-architecture.md*
2. *../02-architecture/transactions-and-consistency.md*

**Components to implement.** Gateway adapter interface; webhook receiver with signature
verification and **replay protection**; bank statement import and reconciliation; optional payer
EDI/API; an outbox pattern for outbound calls.

**Definition of done.**
- [ ] Webhook signatures verified; unsigned requests rejected
- [ ] **Replayed webhook is a no-op** (test)
- [ ] Out-of-order callbacks handled
- [ ] Gateway timeout leaves a recoverable state, never a lost payment
- [ ] Reconciliation detects and reports gateway-vs-ledger variance
- [ ] No integration writes a ledger row except through `PostingService`

---

### Phase 16 — Revenue integrity & production readiness

**Objective.** The safety net, and the go-live gate.

**Prerequisites.** All phases.

**Required reading.**
1. [clinic-financial-modules.md](clinic-financial-modules.md)§7 — the integrity job catalogue
2. *../11-analysis/risks.md* — verify each risk is addressed or accepted
3. *../10-testing/financial-tests.md* and *../10-testing/coverage-gaps.md*

**Components to implement.** All ten integrity jobs from
[clinic-financial-modules.md](clinic-financial-modules.md)§7, each producing a **work queue**;
monitoring and alerting on financial anomalies; a full financial-integrity test suite; runbooks
(failed close, imbalanced ledger, duplicate payment, gateway outage); a data-migration and
opening-balance plan.

**Definition of done.**
- [ ] All ten integrity jobs implemented, scheduled, and green
- [ ] **No job auto-corrects** — all detect and report only ⚠ (the reference project's `fix_total_debit_credit` is the anti-pattern)
- [ ] Full integrity suite passes: debits=credits, no duplicate posting, no duplicate payment, correct balances, correct reversals, correct refunds, correct tax, correct rounding, correct period handling, correct account mapping
- [ ] Every risk in *../11-analysis/risks.md* explicitly addressed or accepted in writing
- [ ] Opening balances loaded and the trial balance ties to the legacy system
- [ ] Runbooks written and rehearsed
- [ ] Load-tested at expected peak with the concurrency tests passing

---

## 6. Recommended master sequence

```
STEP 01  Read the knowledge base           → §7 reading map; start with the three key documents in §0
STEP 02  Decide platform & org shape       → P0
STEP 03  Build Money                       → P1   ⚠ blocks everything
STEP 04  Build chart of accounts & periods → P2
STEP 05  Build the posting engine          → P3   ⚠ the keystone
         ── prove: ledger cannot be corrupted, with no clinical concept present ──
STEP 06  Build pricing        ∥  STEP 07  Build payers & coverage      → P4 ∥ P5
STEP 08  Build charge capture              → P6   ⚠ the clinical pivot
STEP 09  Build invoicing & AR              → P7
STEP 10  Build payments & cash             → P8
         ── ◆ WALKING SKELETON: service → charge → invoice → payment → balanced books ──
STEP 11  Build credits/refunds/adjustments → P9
STEP 12  Build claims & settlement         → P10
STEP 13  Build tax            ∥  STEP 14  Build expenses/AP            → P11 ∥ P12
STEP 15  Build close & reporting           → P13
STEP 16  Complete security & audit         → P14
STEP 17  Build integrations                → P15
STEP 18  Build revenue integrity + go-live → P16
```

**Why this order and not the conventional one.** The generic sequence
(foundation → CoA → engine → billing → invoicing → AR → payments → …) is broadly right, but
this plan differs in three deliberate ways:

1. **Pricing and payers come *before* charge capture**, not after invoicing. A charge cannot be
   created without a price and a payer split, and the split must be computed at capture — that
   is the central fix for the reference project's insurance defects.
2. **There is a distinct Charge Capture phase** with no counterpart in the reference project,
   sitting between pricing/payers and invoicing. It is where seven defects are eliminated.
3. **Claims come after payments**, not with invoicing. Claims are a *settlement* concern; the
   receivable already exists from P7 because the split was done at capture.

---

## 7. Where to find every specification

### Layer 1 — how the reference project works

| Need | Document |
|---|---|
| Orientation | *../01-overview/system-financial-overview.md* |
| Terminology | *../01-overview/financial-glossary.md* |
| Concept inventory & money flow | *../01-overview/financial-domain-map.md* |
| Actors & roles | *../01-overview/actors-and-roles.md* |
| Layered architecture | *../02-architecture/financial-architecture.md* |
| Module coupling & ledger mutation sites | *../02-architecture/module-boundaries.md* |
| Import graph | *../02-architecture/dependency-map.md* |
| Data flow | *../02-architecture/data-flow.md* |
| Transactions, races, idempotency | *../02-architecture/transactions-and-consistency.md* |
| Integrations & the hooks event map | *../02-architecture/integration-architecture.md* |
| **The ledger engine** | *../03-accounting/accounting-model.md* |
| Account tree & types | *../03-accounting/chart-of-accounts.md* |
| Debit/credit rules | *../03-accounting/debit-credit-rules.md* |
| Journal entries | *../03-accounting/journal-entries.md* |
| Posting pipeline & callers | *../03-accounting/posting-rules.md* |
| **Event → journal map** | *../03-accounting/accounting-events.md* |
| Reversals & corrections | *../03-accounting/reversals-and-adjustments.md* |
| Periods & closing | *../03-accounting/financial-periods.md* |
| Money, precision, FX | *../03-accounting/currency-and-rounding.md* |
| Dimensions & budgets | *../03-accounting/dimensions-and-cost-centers.md* |
| Sales invoicing (+ full GL table) | *../04-modules/invoicing.md* |
| Pricing & discounts | *../04-modules/billing-and-pricing.md* |
| Payments | *../04-modules/payments.md* |
| Receivables & reconciliation | *../04-modules/receivables-and-reconciliation.md* |
| Refunds & credit notes | *../04-modules/refunds-and-credit-notes.md* |
| Payables & purchasing | *../04-modules/payables-and-purchasing.md* |
| Tax engine | *../04-modules/taxes.md* |
| Deferred revenue & subscriptions | *../04-modules/deferred-revenue-and-subscriptions.md* |
| POS & cash | *../04-modules/pos-and-cash.md* |
| Banking | *../04-modules/banking-and-reconciliation.md* |
| Inventory & assets | *../04-modules/inventory-and-asset-accounting.md* |
| Payroll | *../04-modules/payroll-and-hr-finance.md* |
| **Clinical charge capture** | *../04-modules/healthcare-billing.md* |
| **Insurance & claims** | *../04-modules/healthcare-insurance.md* |
| Healthcare configuration | *../04-modules/healthcare-configuration.md* |
| Entity catalogue | *../05-data-model/financial-entities.md* |
| Physical schema | *../05-data-model/database-schema.md* |
| ERD & polymorphic links | *../05-data-model/entity-relationships.md* |
| Data lifecycle & mutability | *../05-data-model/data-lifecycle.md* |
| Workflows | *../06-workflows/* — invoice, payment, refund, expense, posting, healthcare billing, insurance claim |
| APIs & services | *../07-api/* |
| Permissions / authorization / audit | *../08-security/* |
| Reports | *../09-reports/* |
| Tests & gaps | *../10-testing/* |
| Assessment | *../11-analysis/* — strengths, weaknesses, risks, technical debt |

### Layer 2 — what to build

| Need | Document |
|---|---|
| Reuse / adapt / reject decisions | [reusable-financial-architecture.md](reusable-financial-architecture.md) |
| **The accounting core spec** | [clinic-accounting-model.md](clinic-accounting-model.md) |
| The clinic chart of accounts | [clinic-chart-of-accounts.md](clinic-chart-of-accounts.md) |
| **Module decomposition & Charge design** | [clinic-financial-modules.md](clinic-financial-modules.md) |
| **The event → entry contract** | [clinic-accounting-events.md](clinic-accounting-events.md) |
| Target schema | [clinic-data-model.md](clinic-data-model.md) |
| Target picture | [implementation-blueprint.md](implementation-blueprint.md) |
| Task → spec traceability | [traceability-matrix.md](traceability-matrix.md) |

---

## 8. The reference project's mistakes you are avoiding

A checklist. Each is **[Confirmed]** in Layer 1 with citations. Re-read this before go-live.

| # | Reference project behaviour | Phase that prevents it |
|---|---|---|
| 1 | Float money arithmetic; raw `float()` and `* 0.01` in insurance code | P1 |
| 2 | `0.5` debit/credit tolerance on most voucher types | P3 |
| 3 | No posting idempotency key | P3 |
| 4 | Posted ledger rows mutated and deleted by raw SQL in four places | P3 |
| 5 | An unreferenced utility that would *silently adjust* an imbalanced voucher | P3, P16 |
| 6 | Missing price silently bills zero | P4 |
| 7 | 24h / 36h / 48h occupancy bills as half a unit | P4, P6 |
| 8 | Coverage resolved at *today's* date, not the service date | P4, P5 |
| 9 | Coverage rule `end_date` never enforced at lookup | P5 |
| 10 | No copay, deductible, benefit cap, or pre-authorisation | P5 |
| 11 | Insurance split done by a post-hoc journal entry | P5, P7 |
| 12 | That journal entry re-fires on every post-submit update, and on invoice cancellation | P3 (idempotency), P10 |
| 13 | That journal entry is never reversed — the claim has no `on_cancel` | P10 |
| 14 | A `Pending`/`Rejected` claim makes the delivered service vanish from billing | P5, P10, P16 |
| 15 | `rejected_claims_account` is required but never read | P10 |
| 16 | Emergency services re-billed on every invoice screen | P6 |
| 17 | Billing state is a boolean written by raw SQL, with no audit trail | P6 |
| 18 | Check-then-set on billing state, not atomic | P6 |
| 19 | Cancelling *any* invoice frees the clinical event | P6, P7 |
| 20 | Draft clinical documents offered for billing | P6 |
| 21 | `outstanding_amount` denormalised without locking | P7 |
| 22 | Invoice-level discounts invisible in the ledger | P7 |
| 23 | Contractual adjustment does not exist as a concept | P9 |
| 24 | Amendment changes the document number | P7 |
| 25 | Registration-fee invoice left in draft while the patient is activated | P6, P16 |
| 26 | `ignore_permissions` + `ignore_mandatory` on auto-invoicing | P14 |
| 27 | No workflow-based approval for any financial document | P14 |
| 28 | SQL injection in a whitelisted claim query | P14 |
| 29 | Allocation history destroyed by `UPDATE … SET against_voucher = null` | P8 |
| 30 | No automated test for any healthcare billing or insurance path | every phase |

---

## 9. Final blueprint

```
                          ┌─────────────────────────────┐
                          │      CLINIC OPERATIONS      │
                          │  scheduling · care delivery │
                          └──────────────┬──────────────┘
                                         │ domain events, one-way
     ┌───────────────────────────────────▼───────────────────────────────────┐
     │                          CHARGE CAPTURE                              │
     │   price at service date  ·  payer split computed once and stored     │
     │   one charge per clinical act, guaranteed by a unique constraint     │
     └───────────┬─────────────────────────────────────────┬────────────────┘
                 │                                         │
        ┌────────▼─────────┐                     ┌─────────▼──────────┐
        │  SELF-PAY        │                     │  PAYER             │
        │  patient invoice │                     │  insurer/corporate │
        │  copay·deductible│                     │  invoice + claim   │
        └────────┬─────────┘                     └─────────┬──────────┘
                 │                                         │
                 │        ┌──────────────────────┐         │
                 └───────►│    RECEIVABLES       │◄────────┘
                          │  separate control    │
                          │  account per payer   │
                          └──────────┬───────────┘
                                     │
                 ┌───────────────────┼───────────────────┐
                 ▼                   ▼                   ▼
        ┌────────────────┐  ┌─────────────────┐  ┌────────────────┐
        │ CASH & PAYMENTS│  │ CREDITS &       │  │ CLAIMS &       │
        │ till · deposits│  │ ADJUSTMENTS     │  │ REMITTANCE     │
        │ gateways       │  │ write-off       │  │ denials·appeals│
        └────────┬───────┘  └────────┬────────┘  └───────┬────────┘
                 │                   │                   │
                 └───────────────────┼───────────────────┘
                                     ▼
     ╔═══════════════════════════════════════════════════════════════════════╗
     ║                        ACCOUNTING CORE                                ║
     ║   PostingService — one door · idempotent · exactly balanced           ║
     ║   ┌─────────────────────────────────────────────────────────────┐    ║
     ║   │  APPEND-ONLY LEDGER   journal_entry / journal_line          │    ║
     ║   │  no UPDATE · no DELETE · corrections are new entries        │    ║
     ║   └─────────────────────────────────────────────────────────────┘    ║
     ╚═══════════════════════════════┬═══════════════════════════════════════╝
                                     │  derived, never stored
                 ┌───────────────────┼───────────────────┐
                 ▼                   ▼                   ▼
        ┌────────────────┐  ┌─────────────────┐  ┌────────────────┐
        │ STATEMENTS     │  │ MANAGEMENT      │  │ CLINIC KPIs    │
        │ TB · P&L · BS  │  │ revenue by      │  │ days in AR ·   │
        │ cash flow      │  │ service·dept·   │  │ denial rate ·  │
        │ AR/AP ageing   │  │ practitioner    │  │ collection %   │
        └────────────────┘  └─────────────────┘  └────────────────┘
                                     ▲
     ┌───────────────────────────────┴───────────────────────────────────────┐
     │  CONTROLS   permissions · separation of duties · approvals ·          │
     │  append-only audit log · reason codes · idempotency ·                 │
     │  REVENUE INTEGRITY JOBS (detect and report — never auto-correct)      │
     └───────────────────────────────────────────────────────────────────────┘
```

---

## Open questions / unverified

1. **Decision A (platform)** is unresolved and materially changes Phases 1–3. Resolve in P0.
2. **Decision B (branch model, currency, payer types)** likewise.
3. Some Layer-1 documents referenced in the reading lists were still being written when this
   plan was authored — see the [README](../FINANCIAL-ROADMAP.md) index for current status. Where a
   referenced document is absent, the nearest complete substitute is named in the phase's
   reading list.
4. **Effort and duration are deliberately not estimated.** They depend entirely on Decision A
   and on team size; estimating them here would be false precision.
5. **Clinical module design is out of scope.** This plan assumes clinical modules can emit the
   domain events listed in
   [clinic-financial-modules.md](clinic-financial-modules.md)§2.6. If they cannot, an adapter
   layer is needed and P6 grows.
6. **Data migration from an existing system** is mentioned only in P16. If the clinic is
   replacing a live system, migration deserves its own phase, planned early — opening balances
   and historical AR are harder than they look.
