# Clinic Accounting Model — Target Design

**Purpose**
Specify the accounting core of the Clinic Management System: the ledger, the posting engine,
the money type, the invariants, and the correction model. This is the foundation every other
financial component depends on.

**Scope**
The accounting engine only — ledger, accounts, posting, periods, reversal, money arithmetic.
Billing, payers and clinical integration are in
[clinic-financial-modules.md](clinic-financial-modules.md).

**Audience**
The developer implementing Phases 1–3 of [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md).

**Related documents**
- *../03-accounting/accounting-model.md* — the reference implementation this derives from
- [reusable-financial-architecture.md](reusable-financial-architecture.md) — the reuse/adapt decisions
- [clinic-chart-of-accounts.md](clinic-chart-of-accounts.md) — the account tree
- [clinic-accounting-events.md](clinic-accounting-events.md) — the event→entry contract
- [clinic-data-model.md](clinic-data-model.md) — the schema

> **Layer 2 document.** Everything here labelled **[Recommended]** is a design decision for
> the new system. Statements about the reference project retain their evidence labels and
> citations.

---

## 1. Design principles

**[Recommended]** Six principles, in priority order. When they conflict, the earlier wins.

1. **The ledger is the truth.** Every balance, every report, every payer statement derives
   from ledger rows. Nothing is authoritative except the ledger.
2. **The ledger is append-only.** No `UPDATE`. No `DELETE`. Ever. Corrections are new rows.
   This is stricter than the reference project, which permits three mutation paths
   (*../02-architecture/module-boundaries.md*§3.2).
3. **Money is exact.** Integer minor units end-to-end. No binary floating point touches an
   amount at any point in its life.
4. **Posting is idempotent.** Every posting carries a unique key; a retry is a no-op, never a
   duplicate.
5. **Every entry is explained.** Each posting names the business event that caused it and, for
   corrections, the reason.
6. **Posting has exactly one door.** All ledger writes go through one service. Nothing else
   may insert a ledger row.

---

## 2. Money

### 2.1 The reference project's approach, and why not to copy it

**[Confirmed]** Amount fields are `Currency`, which Frappe maps to `decimal(21,9)`
**[Inference]**. But Python-side arithmetic uses `float` throughout, mediated by
`flt(value, precision)`. The healthcare and insurance code does not even do that — it uses
the built-in `float()` and the literal `0.01`:

```python
# healthcare/utils.py :: create_insurance_claim   [Confirmed]
insurance_claim.coverage_amount = float(insurance_claim.amount) * 0.01 * float(insurance_claim.coverage)
```

That value is persisted to a `Currency` field and later becomes a Journal Entry's
`debit_in_account_currency`
(*../04-modules/healthcare-insurance.md*§9.3).

**[Confirmed]** The consequence at the ledger level is the tolerance in
`round_off_debit_credit` (`general_ledger.py`):

```python
if gl_map[0]["voucher_type"] in ("Journal Entry", "Payment Entry"):
    allowance = 5.0 / (10**precision)
else:
    allowance = .5
```

A Sales Invoice may be out of balance by up to **0.5 currency units** and the engine will
silently post a round-off entry to absorb it.

### 2.2 [Recommended] the target

A `Money` value object over **integer minor units**:

```
Money
  amount_minor : int64        # e.g. 12345 == 123.45 EGP
  currency     : Currency     # ISO-4217 code + exponent (EGP=2, JPY=0, KWD=3)

  invariants:
    - arithmetic between different currencies raises
    - no float ever enters or leaves; parsing is from string or minor units
    - division returns an explicit allocation, never a truncated quotient

  operations:
    + - (same currency only)
    * n            (integer or Decimal multiplier, with explicit rounding mode)
    allocate(ratios) -> [Money]    # distributes remainder deterministically,
                                   # guaranteeing Σ parts == whole
```

**`allocate` is not optional.** Splitting a charge between payers, apportioning an
invoice-level discount across lines, and computing per-line tax all require distributing a
total across parts such that the parts sum exactly to the total. The reference project handles
this with pro-rata float multiplication and absorbs the residue into a round-off account.
Deterministic allocation removes the residue entirely.

**Storage:** `BIGINT` for the amount plus `CHAR(3)` for the currency. Never a floating type,
never a bare `DECIMAL` without a documented scale.

**Rounding policy [Recommended]:** exactly one place in the system rounds — the tax
calculator, at line level, using half-up, applied once. Everything else is exact integer
arithmetic. Document the policy in one file and reference it from the code.

### 2.3 Multi-currency

**[Recommended]** Decide explicitly whether the clinic needs it.

- **If not** (single-currency clinic): store one amount per ledger row. Do not build the dual
  column machinery. This removes a large amount of complexity.
- **If yes**: copy the reference project's design, which is sound —
  every row carries both the transaction-currency amount (`amount_in_account_currency`) and
  the company-currency amount (`amount`), plus the `account_currency` and the rate used. The
  rate must be **stored on the row**, not looked up later.

---

## 3. The ledger

### 3.1 [Recommended] `journal_entry` and `journal_line`

The reference project uses one flat `GL Entry` table with the voucher identified by
`voucher_type` + `voucher_no`. **[Recommended]** split it into a header and lines, because the
header is where the invariants and the idempotency key belong:

```
journal_entry                          -- the balanced posting (header)
  id                    uuid pk
  clinic_id             uuid           -- tenant/branch scope
  entry_no              bigserial      -- monotonic recording order
  posting_date          date           -- the accounting date
  posted_at             timestamptz    -- when it was actually recorded
  period_id             uuid fk        -- resolved at post time, immutable
  source_type           text           -- 'Invoice' | 'Payment' | 'Adjustment' | ...
  source_id             uuid           -- the business document
  idempotency_key       text UNIQUE    -- ← the duplicate-posting guard
  description           text not null
  reason_code           text           -- required for corrections
  reverses_entry_id     uuid fk null   -- set on a reversing entry
  created_by            uuid not null
  UNIQUE (clinic_id, idempotency_key)

journal_line                           -- the individual debits and credits
  id                    uuid pk
  entry_id              uuid fk not null
  line_no               int not null
  account_id            uuid fk not null
  debit_minor           bigint not null default 0   -- exactly one of these
  credit_minor          bigint not null default 0   -- is non-zero
  currency              char(3) not null
  -- party (for receivable/payable accounts)
  party_type            text null      -- 'Patient' | 'Insurer' | 'Corporate' | 'Supplier' | 'Employee'
  party_id              uuid null
  -- settlement link
  settles_entry_id      uuid null      -- what this line settles (invoice, etc.)
  -- dimensions (real columns, known in advance)
  branch_id             uuid null
  department_id         uuid null
  practitioner_id       uuid null
  cost_center_id        uuid null
  -- provenance
  charge_id             uuid null      -- traceability to the originating charge
  memo                  text
  CHECK (debit_minor >= 0 AND credit_minor >= 0)
  CHECK ((debit_minor = 0) <> (credit_minor = 0))   -- exactly one side
```

**Differences from the reference project, and why:**

| Change | Reason |
|---|---|
| Header/line split | The balance invariant belongs to the header; so does the idempotency key. In the reference project the "voucher" is implicit in a shared column value, so nothing can be constrained at the row level. |
| `idempotency_key UNIQUE` | Closes the double-posting gap. **[Not Found]** in the reference project. |
| `reverses_entry_id` instead of `is_cancelled` on the original | A reversal is a *new fact*, not a mutation of an old one. Preserves append-only. |
| `entry_no` monotonic + `posted_at` | Makes the recording order recoverable independently of `posting_date`, which is essential for audit and for detecting back-dated entries. |
| Real dimension columns | The reference project injects dimensions as runtime custom fields onto 33 DocTypes. You know your axes; use columns and index them. |
| `charge_id` on the line | Direct traceability from ledger row to the clinical charge that caused it. The reference project can only get there via `voucher_no` → invoice → line → `reference_dn`. |
| `CHECK ((debit=0) <> (credit=0))` | The reference project normalises negative debits into credits in `process_gl_map`; a constraint makes the invariant structural instead of procedural. |
| `reason_code` | Mandatory on corrections. **[Not Found]** in the reference project. |

### 3.2 Enforced append-only

**[Recommended]** Do not rely on convention. At the database level:

```sql
REVOKE UPDATE, DELETE ON journal_entry, journal_line FROM app_role;
```

plus a trigger that raises on any attempted update or delete, so an accidental ORM write fails
loudly rather than silently corrupting history.

**Consequence to accept deliberately:** you can no longer "fix" a bad entry. You must reverse
it. That is the point.

### 3.3 Balances are derived

**[Recommended]** As in the reference project — no balance column on `account`.

```
balance(account, as_of_date, dimensions…)
  = Σ debit_minor − Σ credit_minor
    over journal_line joined to journal_entry
    where posting_date <= as_of_date  (and dimension filters)
```

Index `(account_id, posting_date)` and `(party_type, party_id, posting_date)`.

**If aggregation becomes too slow**, add a **periodic snapshot** table
(`account_period_balance`: account, period, opening, debits, credits, closing) rebuilt by a
job — never an incrementally-mutated running total. A snapshot can be recomputed and verified
against the ledger; a running total cannot.

---

## 4. Accounts

**[Recommended]** Keep the reference project's model, which is good.

```
account
  id              uuid pk
  clinic_id       uuid
  code            text not null      -- IMMUTABLE once any line references it
  name            text not null
  parent_id       uuid null          -- adjacency list + a materialised path
  path            ltree/text         -- for subtree queries
  is_group        bool not null      -- only leaves are postable
  root_type       enum(ASSET, LIABILITY, INCOME, EXPENSE, EQUITY)
  account_type    enum(...)          -- behavioural tag; see below
  currency        char(3)
  normal_balance  enum(DEBIT, CREDIT)  -- derived from root_type, stored for clarity
  is_active       bool
  UNIQUE (clinic_id, code)
```

**[Recommended]** Retain the **`account_type` behavioural tag** — it is the reference
project's most quietly useful idea. Code asks for "the receivable control account for
insurers" rather than hard-coding a number. Keep at minimum:
`RECEIVABLE`, `PAYABLE`, `BANK`, `CASH`, `TAX`, `INCOME`, `EXPENSE`, `INVENTORY`,
`COGS`, `FIXED_ASSET`, `ACCUMULATED_DEPRECIATION`, `ROUND_OFF`, `EQUITY`,
`CONTRACTUAL_ADJUSTMENT`, `WRITE_OFF`, `DEFERRED_REVENUE`, `PATIENT_DEPOSIT`.

**[Recommended] Two changes from the reference project:**

1. **`code` is immutable once referenced.** The reference project permits
   `update_account_number`, `merge_account` and `after_rename` on accounts that already carry
   ledger history, which silently rewrites the meaning of historical rows.
2. **Validate the account map at clinic setup, not at first posting.** The reference project's
   cascades return an empty account and fail deep inside `make_gl_entries`
   (*../04-modules/healthcare-configuration.md*§3).
   A `ClinicAccountMap` with a completeness check run at setup — and re-run by a health check —
   turns a mysterious runtime failure into a configuration error.

---

## 5. The posting service — the one door

**[Recommended]** A single function, mirroring the reference project's
`make_gl_entries` but with the invariants tightened.

```
post(draft: JournalEntryDraft) -> JournalEntry

  draft = {
      posting_date, source_type, source_id, description,
      idempotency_key, reason_code?, reverses_entry_id?,
      lines: [ {account_id, debit|credit: Money, party?, settles?, dimensions…, charge_id?} ]
  }
```

Pipeline, in order — each step either passes or raises; there is no silent adjustment:

```
 1. IDEMPOTENCY      lookup idempotency_key → if found, return the existing entry (no-op)
 2. STRUCTURE        ≥2 lines; each line exactly one side; all amounts > 0
 3. BALANCE          Σ debits == Σ credits   EXACTLY. No tolerance.
 4. CURRENCY         every line's currency matches its account's currency
 5. ACCOUNTS         all exist, all is_group = false, all is_active, all same clinic
 6. PARTY            party_type+party_id REQUIRED on RECEIVABLE/PAYABLE accounts,
                     FORBIDDEN elsewhere
 7. DIMENSIONS       cost_center/branch/department required on every INCOME/EXPENSE line
 8. PERIOD           resolve period from posting_date; reject if period is CLOSED
 9. LOCK DATE        reject posting_date <= clinic.ledger_locked_upto
                     unless caller holds the backdate-posting permission
10. PERSIST          insert header + lines in ONE transaction
11. EMIT             JournalEntryPosted domain event (for projections, never for more posting)
```

### 5.1 Why exact balance, with no tolerance

**[Confirmed]** the reference project's `0.5` allowance for non-JE/PE vouchers exists because
float arithmetic on pro-rata discounts and inclusive taxes does not close. With integer money
and `Money.allocate` (§2.2), the arithmetic **does** close, so the tolerance is unnecessary.

**[Recommended]** Keep a `ROUND_OFF` account and permit a round-off line, but only where the
*caller* deliberately creates one — e.g. when a tax authority requires an invoice total
rounded to the nearest unit. The engine never invents one.

### 5.2 Idempotency key construction

**[Recommended]** Deterministic from the business fact, not random:

```
idempotency_key = f"{source_type}:{source_id}:{purpose}[:{sequence}]"

  "Invoice:7f3a…:issue"
  "Payment:91bc…:receipt"
  "Invoice:7f3a…:reverse"
  "Charge:44de…:contractual_adjustment"
  "Asset:12ff…:depreciation:2026-09"
```

This makes a retried job, a duplicated webhook, and a double-clicked button all converge on
the same single entry. It is the single most valuable addition over the reference project.

---

## 6. Correction model

**[Recommended]** Four operations, and no others. Each is a new entry.

| Operation | What it does | Ledger effect | Requires |
|---|---|---|---|
| **Reverse** | Undoes an entry completely | New entry, sides swapped, `reverses_entry_id` set, key `…:reverse` | reason code; source period open **or** an explicit backdate permission |
| **Adjust** | Changes an amount partially | New entry for the delta only | reason code |
| **Write off** | Abandons a receivable | Dr `WRITE_OFF` expense / Cr receivable | reason code; approval above threshold |
| **Contractual adjustment** | Records the list-price-to-contract-price difference | Dr `CONTRACTUAL_ADJUSTMENT` / Cr receivable | payer contract reference |

**[Recommended]** Explicitly forbidden, all of which the reference project permits:

- Editing a posted entry. (Reference: `allow_on_submit` fields on posted documents.)
- Deleting a posted entry. (Reference: `on_trash` with `delete_linked_ledger_entries`.)
- Rewriting settlement links on posted rows. (Reference:
  `unlink_ref_doc_from_payment_entries` runs `UPDATE tabGL Entry SET against_voucher=null`.)
- Deleting and re-posting on recalculation. (Reference:
  `repost_gle_for_stock_vouchers._delete_gl_entries`.)

For the last two: a reallocation of a payment is a **reverse plus a re-post**, which leaves
the original allocation visible in history. That is more rows and it is correct.

### 6.1 Reversing into a closed period

**[Recommended]** A reversal must post to a date the period rules allow. If the original
period is closed, post the reversal to the current open period and record
`original_posting_date` on the entry. Never reopen a closed period to make a reversal fit.

---

## 7. Periods

**[Recommended]** Simpler than the reference project's three overlapping mechanisms
(`Fiscal Year`, `Accounting Period` + `Closed Document`, `Accounts Settings.acc_frozen_upto`,
`Account.freeze_account`). Two concepts suffice:

```
fiscal_year   : id, clinic_id, name, start_date, end_date, status(OPEN|CLOSED)
period        : id, fiscal_year_id, start_date, end_date,
                status(OPEN | SOFT_CLOSED | CLOSED)
```

| Status | Meaning |
|---|---|
| `OPEN` | Normal posting |
| `SOFT_CLOSED` | Only users with the backdate-posting permission may post; used during month-end close |
| `CLOSED` | No posting by anyone. Irreversible except by an explicitly audited reopen. |

Plus `clinic.ledger_locked_upto` as a hard floor, equivalent to the reference project's
`acc_frozen_upto`, checked at step 9 of the pipeline.

**Year-end close [Recommended]:** copy the reference project's Period Closing Voucher logic,
which is correct — for each P&L account with a non-zero balance, post the opposite side, and
balance the whole thing to a retained-earnings account of `root_type` EQUITY (the reference
project validates that the closing account is Liability or Equity —
`period_closing_voucher.py`).
Preserve its per-cost-centre and per-dimension breakdown so that closing does not collapse
your analysis axes.

---

## 8. Invariants and how each is enforced

**[Recommended]** Every invariant needs a named enforcement point *and* a test.

| # | Invariant | Enforced by | Test |
|---|---|---|---|
| I1 | Every entry balances exactly | posting pipeline step 3 | property test over random entries |
| I2 | Trial balance sums to zero for all time | derived from I1 | integrity job + test |
| I3 | No entry is ever updated or deleted | DB grants + trigger | test asserts the trigger raises |
| I4 | Every line has exactly one non-zero side | `CHECK` constraint | test asserts insert fails |
| I5 | Receivable/payable lines always carry a party | pipeline step 6 | unit test |
| I6 | P&L lines always carry cost centre and branch | pipeline step 7 | unit test |
| I7 | The same idempotency key never posts twice | `UNIQUE` constraint | concurrency test, 2 threads |
| I8 | No posting into a CLOSED period | pipeline step 8 | unit test |
| I9 | Account balance == sum of its lines | derivation, no cached column | integrity job |
| I10 | Σ receivable control accounts == Σ open invoice balances | reconciliation job | integration test |
| I11 | A reversing entry's lines mirror the original exactly | reversal service | unit test |
| I12 | Every charge is either unbilled, or on exactly one open invoice line | `UNIQUE (charge_id)` on invoice_line | concurrency test |
| I13 | Money arithmetic never loses a minor unit | `Money.allocate` contract | property test: Σ parts == whole |
| I14 | Currency is never mixed within an entry | pipeline step 4 | unit test |

**I2, I9 and I10 must run as a scheduled integrity job**, not only as tests. The reference
project has an unreferenced `fix_total_debit_credit()` utility
(`accounts/utils.py:573`) that would *silently adjust*
an out-of-balance voucher — evidence that imbalance was expected to occur, and no evidence of
a detector. Build the detector; never build the silent fixer.

---

## 9. What this model deliberately omits

**[Recommended]** Not in the accounting core, to keep it small:

| Omitted | Where it belongs |
|---|---|
| Invoice, charge, payment documents | [clinic-financial-modules.md](clinic-financial-modules.md) |
| Tax calculation | the billing module; the ledger receives finished amounts |
| Pricing | the pricing service |
| Payer split logic | the charge service |
| Inventory valuation | the inventory module, which calls `post()` like any other caller |
| Reporting | read models over the ledger |
| Budgets | a control that runs *before* posting, not part of it |

The accounting core should be implementable and fully testable **without** any clinical or
billing concept present. If it is not, the boundary has leaked.

---

## Open questions / unverified

1. **Target platform.** This design assumes a relational database with real constraints and
   the freedom to define columns. If the clinic system is built *on* Frappe/ERPNext, then
   integer money, `CHECK` constraints, `REVOKE UPDATE`, and real dimension columns are all
   harder or impossible, and the design must be re-evaluated. Resolve this before Phase 1.
2. **Multi-currency need** (§2.3) is unresolved and materially changes the ledger schema.
3. **Multi-tenancy vs multi-branch.** `clinic_id` is shown as the scope column, but whether
   branches are separate legal entities (each needing its own trial balance) or cost centres
   within one entity is a business decision that changes the chart of accounts and the
   closing process.
4. **Snapshot balances** (§3.3) — whether they are needed depends on transaction volume, which
   is unknown. Build the derived path first and measure.
5. Where this document says the reference project's logic is "correct" (period closing, the
   `account_type` tag, the payment/allocation split), that judgement rests on the Layer-1
   documents cited. Re-read those before implementing rather than trusting the summary.
