# Implementation Traceability Matrix

**Purpose**
Map every implementation task to the reference-project analysis that justifies it, the design
document that specifies it, the database objects and APIs it creates, the accounting rule it
implements, and the tests that prove it. Every task must be traceable back to documentation.

**Scope**
All financial implementation tasks across Phases 0–16.

**Audience**
The developer picking up a task, and the reviewer checking it is complete.

**Related documents**
- [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) — the phase definitions and Definition of Done
- [implementation-blueprint.md](implementation-blueprint.md) — the component index

> **How to use.** Find your task. Read the *Source analysis* column first — that is why the task
> exists and what going wrong looks like. Then read the *Specification* column — that is what to
> build. Then implement the *Tests* column before declaring done.

---

## 1. Master matrix

| # | Ph | Implementation task | Source analysis (Layer 1) | Specification (Layer 2) | DB objects | Accounting rule | Tests |
|---|---|---|---|---|---|---|---|
| 1 | 0 | Record platform & org decisions | *system-financial-overview*, *risks* | [IMPL-PLAN §1](IMPLEMENTATION-PLAN.md) | — | — | — |
| 2 | 0 | Commit invariants I1–I14 | *accounting-model* | [clinic-accounting-model §8](clinic-accounting-model.md) | — | all | integrity-check skeleton |
| 3 | 0 | Module skeleton + import-linter | *module-boundaries §2.2* | [clinic-financial-modules §8](clinic-financial-modules.md) | — | — | dependency-violation test |
| 4 | 1 | `Currency` + exponent table | *currency-and-rounding* | [clinic-accounting-model §2.2](clinic-accounting-model.md) | `currency` | — | exponent per currency |
| 5 | 1 | `Money` value object | *currency-and-rounding*, *weaknesses* | [clinic-accounting-model §2.2](clinic-accounting-model.md) | — | exact arithmetic | no-float test; `(a+b)−b==a` |
| 6 | 1 | **`Money.allocate`** | *taxes §discount pro-rata* | [clinic-accounting-model §2.2](clinic-accounting-model.md) | — | Σ parts == whole | **property test (I13)** |
| 7 | 1 | Money persistence mapping | *database-schema* | [clinic-data-model §1](clinic-data-model.md) | `BIGINT`+`CHAR(3)` | — | round-trip lossless |
| 8 | 2 | `Account` + tree | *chart-of-accounts* | [clinic-accounting-model §4](clinic-accounting-model.md), [clinic-chart-of-accounts §2](clinic-chart-of-accounts.md) | `account` | leaf-only posting | no cycles; group rejected |
| 9 | 2 | `root_type` → `normal_balance` | *debit-credit-rules* | [clinic-accounting-model §4](clinic-accounting-model.md) | `account.normal_balance` | normal balance per root | all 5 root types |
| 10 | 2 | `account_type` tag + resolver | *chart-of-accounts* | [clinic-chart-of-accounts §3](clinic-chart-of-accounts.md) | `account.account_type` | behavioural routing | every type resolvable |
| 11 | 2 | Account code immutability | *data-lifecycle* | [clinic-chart-of-accounts §7](clinic-chart-of-accounts.md) | trigger | historical integrity | rename-after-use rejected |
| 12 | 2 | `FiscalYear` / `Period` | *financial-periods* | [clinic-accounting-model §7](clinic-accounting-model.md) | `fiscal_year`, `period` | period control | overlap rejected |
| 13 | 2 | Dimension tables | *dimensions-and-cost-centers* | [clinic-chart-of-accounts §6](clinic-chart-of-accounts.md) | `branch`,`department`,`cost_center` | P&L dimension rule | — |
| 14 | 2 | `ClinicAccountMap` + validator | *healthcare-configuration §3* | [clinic-chart-of-accounts §3](clinic-chart-of-accounts.md) | `clinic_account_map` | no hard-coded accounts | incomplete map fails loudly |
| 15 | 2 | Seed default chart | *chart-of-accounts* | [clinic-chart-of-accounts §2](clinic-chart-of-accounts.md) | seed data | — | every needed type present |
| 16 | 3 | Ledger schema + constraints | *accounting-model §1*, *database-schema* | [clinic-accounting-model §3.1](clinic-accounting-model.md), [clinic-data-model §2.1](clinic-data-model.md) | `journal_entry`,`journal_line` | one side per line | I4 insert rejected |
| 17 | 3 | **Append-only enforcement** | *module-boundaries §3.2* | [clinic-accounting-model §3.2](clinic-accounting-model.md) | trigger + revoked grants | immutability | **I3 update/delete raises** |
| 18 | 3 | Posting pipeline steps 2–7 | *accounting-model*, *posting-rules* | [clinic-accounting-model §5](clinic-accounting-model.md) | — | **exact balance** | I1 property test |
| 19 | 3 | Party & dimension requirements | *accounting-model* (`check_mandatory`, `pl_must_have_cost_center`) | [clinic-accounting-model §5](clinic-accounting-model.md) | — | party on AR/AP; CC on P&L | I5, I6 |
| 20 | 3 | Period & lock-date checks | *financial-periods* | [clinic-accounting-model §5, §7](clinic-accounting-model.md) | — | closed-period block | I8 |
| 21 | 3 | **Idempotency** | *transactions-and-consistency* | [clinic-accounting-model §5.2](clinic-accounting-model.md) | `UNIQUE(clinic_id, idempotency_key)` | one fact, one entry | **I7 concurrency, 2 threads** |
| 22 | 3 | Atomic persistence | *transactions-and-consistency* | [clinic-accounting-model §5](clinic-accounting-model.md) | — | all-or-nothing | partial-failure leaves no rows |
| 23 | 3 | `ReversalService` | *reversals-and-adjustments*, *accounting-events §3* | [clinic-accounting-model §6](clinic-accounting-model.md) | `reverses_entry_id`, `reason_code` | correction by reversal | I11 mirror exact |
| 24 | 3 | `BalanceService` | *accounting-model* (`get_balance_on`) | [clinic-accounting-model §3.3](clinic-accounting-model.md) | indexes | derived balances | I9; trial balance = 0 |
| 25 | 3 | Integrity job v1 | *weaknesses* (`fix_total_debit_credit`) | [clinic-financial-modules §7](clinic-financial-modules.md) | — | detect, never fix | I2 over large dataset |
| 26 | 4 | `Service` + `ServiceCategory` | *healthcare-configuration §5* | [clinic-financial-modules §3](clinic-financial-modules.md), [clinic-data-model §3](clinic-data-model.md) | `service`,`service_category` | revenue account per category | — |
| 27 | 4 | `PriceList` + `ServicePrice` | *billing-and-pricing* | [clinic-financial-modules §3](clinic-financial-modules.md) | `price_list`,`service_price` | time-versioned prices | overlap rejected |
| 28 | 4 | **`resolve()` raises on no price** | *healthcare-billing §7.7*, *healthcare-insurance §4* | [clinic-financial-modules §3](clinic-financial-modules.md) | — | never bill zero silently | **missing price raises** |
| 29 | 4 | Price resolved at service date | *healthcare-insurance §3.1* | [clinic-financial-modules §3](clinic-financial-modules.md) | — | historical accuracy | back-dated case |
| 30 | 4 | `DiscountPolicy` + own account | *accounting-events §1.1* (discounts invisible) | [clinic-chart-of-accounts §2](clinic-chart-of-accounts.md) | `discount_policy` | contra-revenue, not netted | discount visible in ledger |
| 31 | 4 | **`occupancy_units()`** | *healthcare-billing §3* | [clinic-financial-modules §2.5](clinic-financial-modules.md) | `service.unit_hours` | occupancy quantity | **boundary table: 24h→1.0, 36h→1.5, 48h→2.0** |
| 32 | 5 | `Payer` + own AR account | *healthcare-insurance §2.1* | [clinic-financial-modules §4](clinic-financial-modules.md), [clinic-data-model §4](clinic-data-model.md) | `payer` | AR segregation by payer | each payer resolves an account |
| 33 | 5 | `PayerContract` / `PayerPlan` | *healthcare-insurance §2.2–2.3* | [clinic-financial-modules §4](clinic-financial-modules.md) | `payer_contract`,`payer_plan` | contract gating | expired contract blocks |
| 34 | 5 | `CoverageRule` + cascade | *healthcare-insurance §3* | [clinic-financial-modules §4](clinic-financial-modules.md) | `coverage_rule` | coverage resolution | priority order; **`valid_to` enforced** |
| 35 | 5 | `PatientCoverage` validity | *healthcare-insurance §2.5, §9.7* | [clinic-data-model §4](clinic-data-model.md) | `patient_coverage` | policy period | expired → self-pay, not error |
| 36 | 5 | `BenefitAccumulator` | *healthcare-insurance §10* (all absent) | [clinic-financial-modules §4](clinic-financial-modules.md) | `benefit_accumulator` | deductible, cap | concurrency test |
| 37 | 5 | `PreAuthorization` | *healthcare-insurance §10* | [clinic-financial-modules §4](clinic-financial-modules.md) | `preauthorization` | preauth gating | missing preauth → self-pay + flag |
| 38 | 5 | **`SplitCalculator`** | *healthcare-insurance §4, §6* | [clinic-financial-modules §4](clinic-financial-modules.md) | — | copay→deductible→cap→coverage | **Σ splits == net (property)** |
| 39 | 6 | `Charge` + unique constraint | *healthcare-billing §7.1, §7.4* | [clinic-financial-modules §2.2](clinic-financial-modules.md), [clinic-data-model §5](clinic-data-model.md) | `charge` UNIQUE(src,svc) | one charge per act | **duplicate event → one charge** |
| 40 | 6 | `ChargePayerSplit` | *healthcare-insurance §7* | [clinic-financial-modules §2.2](clinic-financial-modules.md) | `charge_payer_split` | stored split | I12 concurrency |
| 41 | 6 | Charge status machine + history | *healthcare-billing §4, §7.3* | [clinic-financial-modules §2.4](clinic-financial-modules.md) | `charge_status_history` | auditable billing state | VOID ≠ WRITE_OFF |
| 42 | 6 | Clinical event handlers | *healthcare-billing §1.1* | [clinic-financial-modules §2.6](clinic-financial-modules.md) | — | event → charge | each idempotent (double delivery) |
| 43 | 6 | Occupancy handler | *healthcare-billing §3, §7.1* | [clinic-financial-modules §2.5](clinic-financial-modules.md) | — | on discharge only | null check-out raises |
| 44 | 6 | `Entitlement` | *healthcare-billing §6* | [clinic-financial-modules §2.7](clinic-financial-modules.md) | `entitlement`, `..._consumption` | revenue forgone visible | over-consumption rejected |
| 45 | 7 | `Invoice` + numbering | *invoicing* | [clinic-financial-modules §5](clinic-financial-modules.md), [clinic-data-model §6](clinic-data-model.md) | `invoice` | gapless immutable | no gaps; cancel keeps number |
| 46 | 7 | `InvoiceLine` from splits | *invoicing §4* | [clinic-financial-modules §5](clinic-financial-modules.md) | `invoice_line` UNIQUE split | one payer per invoice | insured → 2 invoices |
| 47 | 7 | **Invoice posting** | *invoicing §4*, *accounting-events §1.1* | [clinic-accounting-events §2.1](clinic-accounting-events.md) | — | **gross revenue + contra lines** | worked example matches |
| 48 | 7 | Invoice cancellation | *invoicing §3.8*, *accounting-events §3* | [clinic-accounting-events §2.2](clinic-accounting-events.md) | — | reverse, not delete | charges → CAPTURED |
| 49 | 7 | Derived outstanding | *receivables-and-reconciliation*, *financial-architecture §5.3* | [clinic-data-model §6](clinic-data-model.md) | `invoice_balance` view | no denormalised balance | I10 AR vs GL |
| 50 | 7 | Ageing & statements | *financial-statements* (`ReceivablePayableReport`) | [clinic-financial-modules §5](clinic-financial-modules.md) | — | ageing buckets | ties to trial balance |
| 51 | 8 | `Payment` + idempotency | *payments* | [clinic-financial-modules §6](clinic-financial-modules.md), [clinic-data-model §7](clinic-data-model.md) | `payment` 2×UNIQUE | one receipt per fact | **duplicate → one payment** |
| 52 | 8 | Payment posting | *payments*, *accounting-events §1.2* | [clinic-accounting-events §3](clinic-accounting-events.md) | — | Dr cash / Cr AR | per method |
| 53 | 8 | `PaymentAllocation` append-only | *receivables-and-reconciliation*, *module-boundaries §3.2* | [clinic-financial-modules §6](clinic-financial-modules.md) | `payment_allocation` | history preserved | reallocation leaves both rows |
| 54 | 8 | `PatientDeposit` | *financial-domain-map §3.11* (absent) | [clinic-financial-modules §6](clinic-financial-modules.md) | `patient_deposit` | liability, not revenue | apply + refund |
| 55 | 8 | `CashierShift` + variance | *pos-and-cash* | [clinic-accounting-events §3](clinic-accounting-events.md) | `cashier_shift` | variance posted | over and short |
| 56 | 8 | Gateway adapter | *integration-architecture* | [clinic-financial-modules §6](clinic-financial-modules.md) | `payment.external_reference` | clearing → bank | **webhook replay is a no-op** |
| 57 | 9 | `CreditNote` | *refunds-and-credit-notes* | [clinic-accounting-events §2.2](clinic-accounting-events.md) | `credit_note` | proportional reversal | full and partial |
| 58 | 9 | `WriteOff` + approval | *accounting-events §3* | [clinic-accounting-events §2.2](clinic-accounting-events.md) | — | Dr bad debt / Cr AR | threshold enforced |
| 59 | 9 | **`ContractualAdjustment`** | *healthcare-insurance §10* (absent) | [clinic-chart-of-accounts §4](clinic-chart-of-accounts.md) | account 4510/4520 | gross-to-net visible | reportable |
| 60 | 9 | `Refund` | *refunds-and-credit-notes* | [clinic-data-model §7](clinic-data-model.md) | `refund` | cannot exceed received | over-refund rejected |
| 61 | 10 | `Claim` + state machine | *healthcare-insurance §5* | [clinic-data-model §6](clinic-data-model.md) | `claim` | all states declared | no undeclared status |
| 62 | 10 | Partial approval | *healthcare-insurance §9.5* | [clinic-accounting-events §4](clinic-accounting-events.md) | `claim.approved_minor` | shortfall dispositioned | posts explicitly |
| 63 | 10 | **Denial management** | *healthcare-insurance §8, §9.6* | [clinic-accounting-events §4](clinic-accounting-events.md) | `CHECK` disposition NOT NULL | **never vanishes** | **denied → one of 3 destinations** |
| 64 | 10 | `Remittance` | *healthcare-insurance §2.7, §9.5* | [clinic-accounting-events §4](clinic-accounting-events.md) | `remittance` | allocate + post variance | insurer AR ties to claims |
| 65 | 11 | Tax calculation | *taxes* | [clinic-accounting-events §2.1](clinic-accounting-events.md) | `tax_group`,`tax_rate` | inclusive/exclusive | vs hand-computed |
| 66 | 11 | Tax rounding | *currency-and-rounding*, *taxes* | [clinic-accounting-model §2.2](clinic-accounting-model.md) | — | rounded once, line level | policy honoured |
| 67 | 12 | `Supplier` + AP | *payables-and-purchasing* | [clinic-accounting-events §6](clinic-accounting-events.md) | `supplier`,`supplier_invoice` | Dr expense / Cr AP | duplicate bill no. detected |
| 68 | 12 | Inventory & COGS | *inventory-and-asset-accounting* | [clinic-accounting-events §5](clinic-accounting-events.md) | inventory tables | cost ≠ revenue entry | inventory ties to GL |
| 69 | 13 | Period close | *financial-periods* | [clinic-accounting-model §7](clinic-accounting-model.md) | `period.status` | close blocks posting | checklist blocks close |
| 70 | 13 | Year-end close | *financial-periods* (Period Closing Voucher) | [clinic-accounting-events §7](clinic-accounting-events.md) | — | P&L → equity, dimensions kept | P&L zeroed; dimensions intact |
| 71 | 13 | Statement suite | *financial-statements* | [implementation-blueprint §1](implementation-blueprint.md) | read models | derived from ledger | every report ties to TB |
| 72 | 13 | Clinic KPIs | *dashboards-and-metrics* | [implementation-blueprint §1](implementation-blueprint.md) | read models | — | KPI vs manual calc |
| 73 | 14 | Roles & permissions | *permissions* | [IMPL-PLAN P14](IMPLEMENTATION-PLAN.md) | role tables | create ≠ approve | matrix test |
| 74 | 14 | **No permission bypass** | *authorization*, *healthcare-billing §5* | [IMPL-PLAN P14](IMPLEMENTATION-PLAN.md) | — | audited service principal | **bypass attempt fails** |
| 75 | 14 | Approval workflows | *authorization* (no shipped workflows) | [IMPL-PLAN P14](IMPLEMENTATION-PLAN.md) | approval tables | thresholds | above/below threshold |
| 76 | 14 | Separation of duties | *actors-and-roles* | [IMPL-PLAN P14](IMPLEMENTATION-PLAN.md) | — | creator ≠ approver | self-approval rejected |
| 77 | 14 | `financial_audit_log` | *audit*, *healthcare-billing §4* | [clinic-data-model §8](clinic-data-model.md) | `financial_audit_log` | append-only | every op logged |
| 78 | 15 | Webhook security | *integration-architecture* | [IMPL-PLAN P15](IMPLEMENTATION-PLAN.md) | — | signature + replay | unsigned rejected |
| 79 | 15 | Bank reconciliation | *banking-and-reconciliation* | [IMPL-PLAN P15](IMPLEMENTATION-PLAN.md) | bank tables | match ≠ posting | variance reported |
| 80 | 16 | Ten integrity jobs | *coverage-gaps*, *risks* | [clinic-financial-modules §7](clinic-financial-modules.md) | — | detect, never fix | each job triggers on seeded fault |
| 81 | 16 | Financial integrity suite | *financial-tests*, *coverage-gaps* | [IMPL-PLAN P16](IMPLEMENTATION-PLAN.md) | — | all invariants | full suite green |
| 82 | 16 | Opening balances | *financial-periods* | [clinic-accounting-events §7](clinic-accounting-events.md) | — | P&L rejected in opening | TB ties to legacy |

---

## 2. Worked traceability example

The user's requested pattern, for one task:

```
TASK 38 — Implement SplitCalculator
     │
     ├─ WHY IT EXISTS ─────────────────────────────────────────────────────────
     │  ../04-modules/healthcare-insurance.md §6
     │      the reference project splits the receivable with a post-hoc
     │      Journal Entry, not at capture
     │  ../04-modules/healthcare-insurance.md §9.1, §9.2
     │      that entry re-fires on cancellation and is never reversed
     │  ../04-modules/healthcare-insurance.md §9.3
     │      it computes coverage with raw float() and * 0.01
     │  ../04-modules/healthcare-insurance.md §10
     │      copay, deductible and caps do not exist at all
     │
     ├─ WHAT TO BUILD ─────────────────────────────────────────────────────────
     │  clinic-financial-modules.md §4       the ordered split algorithm
     │  clinic-data-model.md §4              coverage_rule, benefit_accumulator
     │  clinic-accounting-model.md §2.2      Money.allocate for exact summing
     │
     ├─ WHAT IT POSTS ─────────────────────────────────────────────────────────
     │  clinic-accounting-events.md §2.1     the invoice entry the split feeds,
     │                                       with the worked 500.00 example
     │
     ├─ WHAT IT WRITES ────────────────────────────────────────────────────────
     │  charge_payer_split rows, one per payer, with an explicit basis
     │
     └─ HOW TO PROVE IT ───────────────────────────────────────────────────────
        property test: Σ splits == charge.net_minor, over random inputs
        cases: expired coverage · excluded service · fixed copay · % copay
               partial deductible · cap reached · coverage > rate
               missing preauth · concurrent accumulator update
        IMPL-PLAN P5 Definition of Done — all ten checkboxes
```

---

## 3. Reverse index — every Layer-1 document to the tasks it justifies

| Layer-1 document | Tasks |
|---|---|
| *accounting-model* | 2, 16, 18, 19, 24 |
| *chart-of-accounts* | 8, 10, 15 |
| *debit-credit-rules* | 9 |
| *posting-rules* | 18 |
| *accounting-events* | 30, 47, 48, 52, 58 |
| *reversals-and-adjustments* | 23 |
| *financial-periods* | 12, 20, 69, 70, 82 |
| *currency-and-rounding* | 4, 5, 6, 66 |
| *dimensions-and-cost-centers* | 13 |
| *invoicing* | 45, 46, 47, 48 |
| *billing-and-pricing* | 27 |
| *payments* | 51, 52 |
| *receivables-and-reconciliation* | 49, 53 |
| *refunds-and-credit-notes* | 57, 60 |
| *payables-and-purchasing* | 67 |
| *taxes* | 6, 65, 66 |
| *pos-and-cash* | 55 |
| *banking-and-reconciliation* | 79 |
| *inventory-and-asset-accounting* | 68 |
| ***healthcare-billing*** | **28, 31, 39, 41, 42, 43, 44, 74** |
| ***healthcare-insurance*** | **28, 32, 33, 34, 35, 36, 37, 38, 40, 59, 61, 62, 63, 64** |
| *healthcare-configuration* | 14, 26 |
| *database-schema* | 7, 16 |
| *data-lifecycle* | 11 |
| *module-boundaries* | 3, 17, 25, 53 |
| *transactions-and-consistency* | 21, 22 |
| *integration-architecture* | 56, 78 |
| *financial-architecture* | 49 |
| *permissions* | 73 |
| *authorization* | 74, 75 |
| *audit* | 77 |
| *actors-and-roles* | 76 |
| *financial-statements* | 50, 71 |
| *dashboards-and-metrics* | 72 |
| *financial-tests* | 81 |
| *coverage-gaps* | 80, 81 |
| *weaknesses* | 5, 25 |
| *risks* | 1, 80 |

**[Confirmed]** The two healthcare documents together justify 20 of the 82 tasks — the highest
concentration in the matrix. That is a direct measure of where the reference project's problems
are, and where the clinic system's design effort must go.

---

## Open questions / unverified

1. Task numbering is stable but not exhaustive — tasks 65–72 (tax, expenses, reporting) are
   stated at a coarser grain than 1–64 because their Layer-1 sources cover broader ground.
2. Some Layer-1 documents referenced here were still being written when this matrix was
   authored; see the [README](../FINANCIAL-ROADMAP.md) index for current status. Where a document is
   absent, the task's *why* is still recoverable from the sibling documents named in the same row.
3. No effort estimates are attached, deliberately — see
   [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) open questions.
