# Final Implementation Blueprint

**Purpose**
The single-page target picture of the clinic system's financial subsystem: every component, how
they connect, and where each is specified.

**Scope**
The whole financial subsystem, at the level of components and their contracts.

**Audience**
Anyone needing the whole shape at once — for onboarding, for review, or for a status wall.

**Related documents**
- [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) — the build sequence
- [clinic-financial-modules.md](clinic-financial-modules.md) — module detail
- [clinic-accounting-model.md](clinic-accounting-model.md) — the core
- [traceability-matrix.md](traceability-matrix.md) — task → specification

> **Layer 2 document.** All **[Recommended]**.

---

## 1. The complete blueprint

```
════════════════════════════════════════════════════════════════════════════════════
                          CLINIC MANAGEMENT SYSTEM
                          FINANCIAL SUBSYSTEM
════════════════════════════════════════════════════════════════════════════════════

┌──────────────────────────────────────────────────────────────────────────────────┐
│ CLINICAL DOMAIN (out of scope; emits events only, imports nothing financial)      │
│                                                                                  │
│  Scheduling   Encounters   Orders   Laboratory   Imaging   Pharmacy   Inpatient  │
│      │            │           │          │          │          │          │      │
│      └────────────┴───────────┴──────────┴──────────┴──────────┴──────────┘      │
│                                    │                                             │
│         ConsultationCompleted · LabOrderResulted · ProcedurePerformed ·          │
│         ImagingStudyCompleted · MedicationDispensed · OccupancyEnded ·           │
│         TherapySessionCompleted · PatientRegistered · NoShowRecorded            │
└────────────────────────────────────┬─────────────────────────────────────────────┘
                                     │ domain events — ONE WAY, idempotent handlers
╔════════════════════════════════════▼═════════════════════════════════════════════╗
║ M6  CHARGE CAPTURE                            spec: clinic-financial-modules §2  ║
║ ─────────────────────────────────────────────────────────────────────────────────║
║  Charge                        UNIQUE(source_type, source_id, service_id)        ║
║    price captured at SERVICE DATE · revenue account & dimensions resolved once   ║
║    status: DRAFT → CAPTURED → INVOICED → {VOIDED | WRITTEN_OFF}                 ║
║  ChargePayerSplit              invoice_line_id UNIQUE                            ║
║    basis: COVERAGE | COPAY | DEDUCTIBLE | EXCLUSION |                            ║
║           CONTRACTUAL_ADJUSTMENT | SELF_PAY                                     ║
║    INVARIANT: Σ splits == charge.net                                             ║
║  Entitlement + Consumption     CHECK(consumed <= total)                          ║
║  ChargeStatusHistory           append-only                                       ║
╚═══════════┬═════════════════════════════════════════════════════┬════════════════╝
            │ needs a price                     needs a split     │
┌───────────▼───────────────────┐          ┌────────────────────▼─────────────────┐
│ M5  PRICING                   │          │ M4  PAYER                            │
│ spec: clinic-financial-       │          │ spec: clinic-financial-modules §4    │
│       modules §3              │          │                                      │
│ ───────────────────────────── │          │ ──────────────────────────────────── │
│ ServiceCategory → revenue acct│          │ Payer: SELF_PAY|INSURER|CORPORATE    │
│ Service (unit_hours, taxable) │          │   each with its OWN AR account       │
│ PriceList: CASH|PAYER_TARIFF| │          │ PayerContract  (validity enforced)   │
│            CORPORATE|INTERNAL │          │ PayerPlan (cap, deductible, OOP max) │
│ ServicePrice  TIME-VERSIONED  │          │ CoverageRule (priority; valid_to     │
│   never updated; superseded   │          │   ACTUALLY enforced)                 │
│ DiscountPolicy → own account  │          │ PatientCoverage (valid_from + to)    │
│                               │          │ BenefitAccumulator (optimistic lock) │
│ resolve() RAISES on no price  │          │ PreAuthorization                     │
│ occupancy_units() — corrected │          │ SplitCalculator: Σ splits == net     │
└───────────────────────────────┘          └──────────────────────────────────────┘
            │                                                     │
            └──────────────────────────┬──────────────────────────┘
                                       ▼
╔══════════════════════════════════════════════════════════════════════════════════╗
║ M3  BILLING & ACCOUNTS RECEIVABLE              spec: clinic-financial-modules §5 ║
║ ─────────────────────────────────────────────────────────────────────────────────║
║  Invoice — ONE PAYER each · gapless immutable number · grouped by encounter      ║
║  InvoiceLine — charge_split_id UNIQUE                                            ║
║  outstanding is DERIVED (view), never a mutable column                           ║
║  CreditNote (reason mandatory) · Statement · Ageing by payer type                ║
║  Claim (denied ⇒ disposition REQUIRED) · ClaimBatch · Remittance                ║
╚══════════════════════════════════════┬═══════════════════════════════════════════╝
                                       ▼
╔══════════════════════════════════════════════════════════════════════════════════╗
║ M2  CASH & PAYMENTS                            spec: clinic-financial-modules §6 ║
║ ─────────────────────────────────────────────────────────────────────────────────║
║  Payment — idempotency_key UNIQUE · (gateway, external_ref) UNIQUE              ║
║  PaymentAllocation — APPEND-ONLY; reallocation = reverse + new                   ║
║  PatientDeposit — a LIABILITY until applied                                      ║
║  CashierShift — variance is POSTED, not just recorded                            ║
║  Refund (reason + approval) · BankAccount · GatewayAdapter                       ║
╚══════════════════════════════════════┬═══════════════════════════════════════════╝
                                       ▼
╔══════════════════════════════════════════════════════════════════════════════════╗
║ M1  ACCOUNTING CORE                                spec: clinic-accounting-model ║
║ ─────────────────────────────────────────────────────────────────────────────────║
║  Money — INTEGER MINOR UNITS · allocate() guarantees Σ parts == whole            ║
║  Account — code IMMUTABLE once used · account_type behavioural tag               ║
║  ClinicAccountMap — purpose → account · completeness validated at SETUP          ║
║  FiscalYear / Period — OPEN | SOFT_CLOSED | CLOSED · ledger_locked_upto          ║
║                                                                                  ║
║  ┌────────────────────────────────────────────────────────────────────────────┐ ║
║  │ PostingService.post(draft)  ── THE ONE DOOR ──                             │ ║
║  │  1 idempotency (key UNIQUE → replay is a no-op)                            │ ║
║  │  2 structure   3 BALANCE EXACT (no tolerance)   4 currency   5 accounts    │ ║
║  │  6 party req'd on AR/AP   7 dimensions req'd on P&L   8 period open        │ ║
║  │  9 lock date   10 persist in ONE transaction   11 emit event               │ ║
║  └────────────────────────────────────────────────────────────────────────────┘ ║
║  ReversalService — reason mandatory · reverses_entry_id · never mutates          ║
║  BalanceService  — always derived; no stored balance column                      ║
║                                                                                  ║
║  ╔════════════════════════════════════════════════════════════════════════════╗ ║
║  ║  journal_entry / journal_line      APPEND-ONLY, DB-ENFORCED                ║ ║
║  ║  no UPDATE · no DELETE · trigger raises · grants revoked                   ║ ║
║  ║  CHECK((debit=0) <> (credit=0))  ·  real FKs  ·  real dimension columns    ║ ║
║  ╚════════════════════════════════════════════════════════════════════════════╝ ║
╚══════════════════════════════════════┬═══════════════════════════════════════════╝
                                       │ derived, read-only
        ┌──────────────────────────────┼──────────────────────────────┐
        ▼                              ▼                              ▼
┌───────────────────┐   ┌──────────────────────────┐   ┌────────────────────────┐
│ STATUTORY         │   │ MANAGEMENT               │   │ CLINIC KPIs            │
│ Trial Balance     │   │ Revenue by service line  │   │ Days in AR             │
│ Profit & Loss     │   │ Revenue by department    │   │ Collection rate        │
│ Balance Sheet     │   │ Revenue by practitioner  │   │ Denial rate            │
│ Cash Flow         │   │ Revenue by branch        │   │ Contractual adj. rate  │
│ GL detail         │   │ Gross → net revenue      │   │ Revenue per encounter  │
│ AR/AP ageing      │   │ Payer performance        │   │ Unbilled charge value  │
└───────────────────┘   └──────────────────────────┘   └────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────────┐
│ M7  REVENUE INTEGRITY                          spec: clinic-financial-modules §7 │
│ ─────────────────────────────────────────────────────────────────────────────────│
│  DETECT AND REPORT — NEVER AUTO-CORRECT                                          │
│  · unbilled charges aged        · split imbalance      · orphan clinical events  │
│  · zero-price charges           · trial balance ≠ 0    · AR vs GL mismatch       │
│  · stale claims                 · denials without disposition                     │
│  · unapplied deposits           · entitlement leakage                             │
└──────────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────────┐
│ CROSS-CUTTING CONTROLS                                       spec: 08-security/  │
│  Roles: Cashier · Billing Clerk · Billing Supervisor · Accountant ·              │
│         Finance Manager · Auditor(read-only) · Clinician                          │
│  Permissions separate CREATE / ISSUE / CANCEL / APPROVE                          │
│  Approval thresholds: refunds · write-offs · manual entries · price overrides    │
│  ENFORCED separation of duties · append-only financial_audit_log ·               │
│  mandatory reason codes · idempotency keys everywhere                            │
│  NO money path bypasses permissions (contrast: the reference project's           │
│  ignore_permissions + ignore_mandatory on auto-invoicing)                        │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Component → specification index

| Component | Specified in |
|---|---|
| `Money`, `Currency` | [clinic-accounting-model.md](clinic-accounting-model.md)§2 |
| `Account`, `ClinicAccountMap` | [clinic-accounting-model.md](clinic-accounting-model.md)§4, [clinic-chart-of-accounts.md](clinic-chart-of-accounts.md) |
| `FiscalYear`, `Period` | [clinic-accounting-model.md](clinic-accounting-model.md)§7 |
| `journal_entry`, `journal_line` | [clinic-accounting-model.md](clinic-accounting-model.md)§3, [clinic-data-model.md](clinic-data-model.md)§2 |
| `PostingService` | [clinic-accounting-model.md](clinic-accounting-model.md)§5 |
| `ReversalService` | [clinic-accounting-model.md](clinic-accounting-model.md)§6 |
| Invariants I1–I14 | [clinic-accounting-model.md](clinic-accounting-model.md)§8 |
| `Service`, `PriceList`, `ServicePrice` | [clinic-financial-modules.md](clinic-financial-modules.md)§3, [clinic-data-model.md](clinic-data-model.md)§3 |
| `occupancy_units()` | [clinic-financial-modules.md](clinic-financial-modules.md)§2.5 |
| `Payer`, `CoverageRule`, `SplitCalculator` | [clinic-financial-modules.md](clinic-financial-modules.md)§4, [clinic-data-model.md](clinic-data-model.md)§4 |
| `Charge`, `ChargePayerSplit` | [clinic-financial-modules.md](clinic-financial-modules.md)§2, [clinic-data-model.md](clinic-data-model.md)§5 |
| `Entitlement` | [clinic-financial-modules.md](clinic-financial-modules.md)§2.7 |
| `Invoice`, `Claim`, `Remittance` | [clinic-financial-modules.md](clinic-financial-modules.md)§5, [clinic-data-model.md](clinic-data-model.md)§6 |
| `Payment`, `Deposit`, `CashierShift` | [clinic-financial-modules.md](clinic-financial-modules.md)§6, [clinic-data-model.md](clinic-data-model.md)§7 |
| Every event → entry | [clinic-accounting-events.md](clinic-accounting-events.md) |
| Integrity jobs | [clinic-financial-modules.md](clinic-financial-modules.md)§7 |
| `financial_audit_log` | [clinic-data-model.md](clinic-data-model.md)§8 |
| Build order and Definition of Done | [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md)§5 |

---

## 3. The seven design commitments

Each is a deliberate departure from the reference project, each traceable to a **[Confirmed]**
defect in Layer 1.

| # | Commitment | Replaces | Evidence |
|---|---|---|---|
| 1 | **Integer minor units everywhere** | float arithmetic and a `0.5` ledger tolerance | *../03-accounting/accounting-model.md*, *../04-modules/healthcare-insurance.md*§9.3 |
| 2 | **A first-class `Charge` with a lifecycle** | an `invoiced` boolean written by raw SQL | *../04-modules/healthcare-billing.md*§4, §7 |
| 3 | **Payer split computed once at capture and stored** | a post-hoc AR-transfer journal entry that is never reversed | *../04-modules/healthcare-insurance.md*§6, §9.1 |
| 4 | **Append-only ledger, DB-enforced** | three raw-SQL mutation and deletion paths | *../02-architecture/module-boundaries.md*§3.2 |
| 5 | **Idempotency key on every posting and payment** | nothing — `docstatus` was the only guard | *../02-architecture/transactions-and-consistency.md* |
| 6 | **Nothing silently vanishes** — a missing price raises; a denied claim must be dispositioned | silent zeros and silently dropped services | *../04-modules/healthcare-billing.md*§7.7, *../04-modules/healthcare-insurance.md*§8 |
| 7 | **Detect, never auto-correct** | an unreferenced `fix_total_debit_credit()` that would falsify amounts to force balance | *../02-architecture/module-boundaries.md*§3.2 |

---

## Open questions / unverified

1. This blueprint assumes the standalone platform choice. See
   [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md)§1 Decision A.
2. Inventory/COGS and payroll appear only as posting callers; neither is designed in this
   document set beyond the events in
   [clinic-accounting-events.md](clinic-accounting-events.md)§5–6.
3. Reporting is shown as read models over the ledger; no specific report definitions are given —
   the reference project's `financial_statements.py` engine is the model to follow
   (*../09-reports/financial-statements.md*).
