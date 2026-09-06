# Clinic Financial Data Model — Target Schema

**Purpose**
The complete target schema for the clinic system's financial subsystem: tables, columns, keys,
constraints and indexes, with the rationale for every constraint that differs from the
reference project.

**Scope**
Financial tables only. Clinical tables appear only as the `source_type`/`source_id` references
that charges point at.

**Audience**
The developer writing migrations, in Phases 1–13.

**Related documents**
- *../05-data-model/financial-entities.md* — the reference project's entity catalogue
- *../05-data-model/database-schema.md* — the reference physical schema
- [clinic-accounting-model.md](clinic-accounting-model.md) — the ledger design rationale
- [clinic-financial-modules.md](clinic-financial-modules.md) — the module each table belongs to

> **Layer 2 document.** All **[Recommended]**. Reference-project comparisons carry evidence labels.
> Syntax is PostgreSQL-flavoured; adapt as needed. `money_minor` denotes `BIGINT`.

---

## 1. Conventions

| Convention | Rule | Why |
|---|---|---|
| Primary keys | `uuid` | Safe to generate client-side; no sequence contention |
| Money | `BIGINT` minor units + `CHAR(3)` currency, always adjacent | No float can enter — see [clinic-accounting-model.md](clinic-accounting-model.md)§2 |
| Tenancy | `clinic_id` on every table | Explicit; never implicit |
| Timestamps | `created_at`, `created_by` on everything; `updated_at`/`updated_by` only on mutable tables | Ledger tables have no update columns *by design* |
| Enums | DB enum or a `CHECK` constraint, never free text | The reference project writes undeclared status values — **[Confirmed]** `'Payment Requested'` and `'Payment Approved'` are absent from the claim's own Select options (*../04-modules/healthcare-insurance.md*§5) |
| Foreign keys | **Real FKs everywhere** | **[Confirmed]** the reference project creates none — Link fields are application-level only |
| Soft delete | **None on financial tables** | Cancel or reverse; never hide |

---

## 2. M1 — Accounting core

```sql
CREATE TABLE currency (
  code          CHAR(3)     PRIMARY KEY,
  name          TEXT        NOT NULL,
  exponent      SMALLINT    NOT NULL CHECK (exponent BETWEEN 0 AND 4),
  symbol        TEXT
);  -- EGP 2, USD 2, JPY 0, KWD 3

CREATE TABLE clinic (
  id                   UUID PRIMARY KEY,
  code                 TEXT NOT NULL UNIQUE,
  name                 TEXT NOT NULL,
  base_currency        CHAR(3) NOT NULL REFERENCES currency(code),
  ledger_locked_upto   DATE,
  revenue_recognition  TEXT NOT NULL DEFAULT 'AT_INVOICE'
                       CHECK (revenue_recognition IN ('AT_INVOICE','AT_SERVICE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE branch (
  id UUID PRIMARY KEY,
  clinic_id UUID NOT NULL REFERENCES clinic(id),
  code TEXT NOT NULL, name TEXT NOT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (clinic_id, code)
);

CREATE TABLE department (
  id UUID PRIMARY KEY,
  clinic_id UUID NOT NULL REFERENCES clinic(id),
  code TEXT NOT NULL, name TEXT NOT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (clinic_id, code)
);

CREATE TABLE cost_center (
  id UUID PRIMARY KEY,
  clinic_id UUID NOT NULL REFERENCES clinic(id),
  code TEXT NOT NULL, name TEXT NOT NULL,
  parent_id UUID REFERENCES cost_center(id),
  branch_id UUID REFERENCES branch(id),
  is_group BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (clinic_id, code)
);

CREATE TABLE account (
  id              UUID PRIMARY KEY,
  clinic_id       UUID NOT NULL REFERENCES clinic(id),
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  parent_id       UUID REFERENCES account(id),
  path            TEXT NOT NULL,                     -- materialised, e.g. '1000.1100.1210'
  depth           SMALLINT NOT NULL,
  is_group        BOOLEAN NOT NULL DEFAULT FALSE,
  root_type       TEXT NOT NULL CHECK (root_type IN
                    ('ASSET','LIABILITY','INCOME','EXPENSE','EQUITY')),
  normal_balance  TEXT NOT NULL CHECK (normal_balance IN ('DEBIT','CREDIT')),
  account_type    TEXT,                              -- behavioural tag; see §2.1
  currency        CHAR(3) NOT NULL REFERENCES currency(code),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, code),
  CHECK (parent_id <> id)
);
CREATE INDEX account_path_idx   ON account (clinic_id, path);
CREATE INDEX account_type_idx   ON account (clinic_id, account_type) WHERE is_active;

CREATE TABLE clinic_account_map (
  id UUID PRIMARY KEY,
  clinic_id  UUID NOT NULL REFERENCES clinic(id),
  purpose    TEXT NOT NULL,      -- 'AR_PATIENT', 'REVENUE_BY_SERVICE_CATEGORY', ...
  qualifier  TEXT,               -- category / payer type / till id; NULL for singletons
  account_id UUID NOT NULL REFERENCES account(id),
  UNIQUE (clinic_id, purpose, qualifier)
);

CREATE TABLE fiscal_year (
  id UUID PRIMARY KEY,
  clinic_id UUID NOT NULL REFERENCES clinic(id),
  name TEXT NOT NULL, start_date DATE NOT NULL, end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  UNIQUE (clinic_id, name),
  CHECK (end_date > start_date)
  -- non-overlap enforced by an exclusion constraint or a trigger
);

CREATE TABLE period (
  id UUID PRIMARY KEY,
  fiscal_year_id UUID NOT NULL REFERENCES fiscal_year(id),
  clinic_id UUID NOT NULL REFERENCES clinic(id),
  start_date DATE NOT NULL, end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN'
         CHECK (status IN ('OPEN','SOFT_CLOSED','CLOSED')),
  closed_at TIMESTAMPTZ, closed_by UUID,
  CHECK (end_date >= start_date)
);
CREATE INDEX period_lookup_idx ON period (clinic_id, start_date, end_date);
```

### 2.1 The ledger — append-only

```sql
CREATE TABLE journal_entry (
  id                UUID PRIMARY KEY,
  clinic_id         UUID NOT NULL REFERENCES clinic(id),
  entry_no          BIGSERIAL NOT NULL,          -- recording order
  posting_date      DATE NOT NULL,               -- accounting date
  posted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  period_id         UUID NOT NULL REFERENCES period(id),
  source_type       TEXT NOT NULL,               -- 'Invoice','Payment','Adjustment',...
  source_id         UUID NOT NULL,
  idempotency_key   TEXT NOT NULL,
  description       TEXT NOT NULL,
  reason_code       TEXT,                        -- required on corrections
  reverses_entry_id UUID REFERENCES journal_entry(id),
  original_posting_date DATE,                    -- when reversing into a later period
  created_by        UUID NOT NULL,
  UNIQUE (clinic_id, idempotency_key),           -- ◄ the duplicate-posting guard
  UNIQUE (clinic_id, entry_no)
);
CREATE INDEX je_source_idx ON journal_entry (clinic_id, source_type, source_id);
CREATE INDEX je_date_idx   ON journal_entry (clinic_id, posting_date);

CREATE TABLE journal_line (
  id             UUID PRIMARY KEY,
  entry_id       UUID NOT NULL REFERENCES journal_entry(id),
  line_no        SMALLINT NOT NULL,
  account_id     UUID NOT NULL REFERENCES account(id),
  debit_minor    BIGINT NOT NULL DEFAULT 0,
  credit_minor   BIGINT NOT NULL DEFAULT 0,
  currency       CHAR(3) NOT NULL REFERENCES currency(code),
  -- party (mandatory on receivable/payable accounts)
  party_type     TEXT CHECK (party_type IN
                   ('PATIENT','INSURER','CORPORATE','SUPPLIER','EMPLOYEE','PRACTITIONER')),
  party_id       UUID,
  -- settlement
  settles_entry_id UUID REFERENCES journal_entry(id),
  -- dimensions
  branch_id      UUID REFERENCES branch(id),
  department_id  UUID REFERENCES department(id),
  cost_center_id UUID REFERENCES cost_center(id),
  practitioner_id UUID,
  -- provenance
  charge_id      UUID,
  memo           TEXT,
  UNIQUE (entry_id, line_no),
  CHECK (debit_minor >= 0 AND credit_minor >= 0),
  CHECK ((debit_minor = 0) <> (credit_minor = 0)),        -- exactly one side
  CHECK ((party_type IS NULL) = (party_id IS NULL))
);
CREATE INDEX jl_account_idx ON journal_line (account_id);
CREATE INDEX jl_party_idx   ON journal_line (party_type, party_id);
CREATE INDEX jl_settles_idx ON journal_line (settles_entry_id);
CREATE INDEX jl_charge_idx  ON journal_line (charge_id);
```

**Append-only enforcement:**

```sql
CREATE FUNCTION ledger_is_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Ledger rows are immutable (attempted % on %)', TG_OP, TG_TABLE_NAME;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER je_no_mutate  BEFORE UPDATE OR DELETE ON journal_entry
  FOR EACH ROW EXECUTE FUNCTION ledger_is_append_only();
CREATE TRIGGER jl_no_mutate  BEFORE UPDATE OR DELETE ON journal_line
  FOR EACH ROW EXECUTE FUNCTION ledger_is_append_only();

REVOKE UPDATE, DELETE ON journal_entry, journal_line FROM app_role;
```

**Comparison with the reference project's `tabGL Entry`:**

| Aspect | Reference project | This design | Why |
|---|---|---|---|
| Structure | One flat table; voucher implicit in `voucher_type`+`voucher_no` | Header + lines | The balance invariant and the idempotency key belong to the header |
| Idempotency | **[Not Found]** | `UNIQUE (clinic_id, idempotency_key)` | Closes the double-posting gap |
| Cancellation | `UPDATE … SET is_cancelled = 1` on originals | `reverses_entry_id` on the reversal | A reversal is a new fact, not a mutation |
| Mutation | Four production raw-SQL sites update/delete rows (*../02-architecture/module-boundaries.md*§3.2) | Trigger + revoked grants | Structural immutability |
| One-side-only | Enforced procedurally in `process_gl_map` | `CHECK` constraint | Structural |
| Dimensions | Runtime-injected custom fields on 33 doctypes | Real indexed columns | Axes are known in advance |
| FKs | None | All | Referential integrity |
| Charge traceability | Via `voucher_no` → invoice → line → `reference_dn` | `charge_id` on the line | Direct |

---

## 3. M5 — Pricing

```sql
CREATE TABLE service_category (
  id UUID PRIMARY KEY, clinic_id UUID NOT NULL REFERENCES clinic(id),
  code TEXT NOT NULL, name TEXT NOT NULL,
  revenue_account_id UUID NOT NULL REFERENCES account(id),
  cogs_account_id UUID REFERENCES account(id),
  UNIQUE (clinic_id, code)
);

CREATE TABLE service (
  id UUID PRIMARY KEY, clinic_id UUID NOT NULL REFERENCES clinic(id),
  code TEXT NOT NULL, name TEXT NOT NULL,
  category_id UUID NOT NULL REFERENCES service_category(id),
  revenue_account_id UUID REFERENCES account(id),   -- overrides the category
  default_cost_center_id UUID REFERENCES cost_center(id),
  department_id UUID REFERENCES department(id),
  is_taxable BOOLEAN NOT NULL DEFAULT TRUE,
  tax_group_id UUID,
  unit_hours NUMERIC(6,2),          -- for time/occupancy-based services
  is_stock_item BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (clinic_id, code)
);

CREATE TABLE price_list (
  id UUID PRIMARY KEY, clinic_id UUID NOT NULL REFERENCES clinic(id),
  code TEXT NOT NULL, name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('CASH','PAYER_TARIFF','CORPORATE','INTERNAL')),
  currency CHAR(3) NOT NULL REFERENCES currency(code),
  valid_from DATE NOT NULL, valid_to DATE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (clinic_id, code)
);

CREATE TABLE service_price (
  id UUID PRIMARY KEY,
  price_list_id UUID NOT NULL REFERENCES price_list(id),
  service_id UUID NOT NULL REFERENCES service(id),
  unit_price_minor BIGINT NOT NULL CHECK (unit_price_minor >= 0),
  currency CHAR(3) NOT NULL REFERENCES currency(code),
  valid_from DATE NOT NULL, valid_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  -- non-overlapping (price_list_id, service_id, validity) enforced by
  -- an exclusion constraint; NEVER updated in place — supersede instead
);
CREATE INDEX sp_lookup_idx ON service_price (price_list_id, service_id, valid_from);

CREATE TABLE discount_policy (
  id UUID PRIMARY KEY, clinic_id UUID NOT NULL REFERENCES clinic(id),
  code TEXT NOT NULL, name TEXT NOT NULL,
  basis TEXT NOT NULL CHECK (basis IN ('PERCENT','AMOUNT')),
  value NUMERIC(12,4) NOT NULL,
  contra_account_id UUID NOT NULL REFERENCES account(id),   -- its OWN account
  requires_approval_above_minor BIGINT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (clinic_id, code)
);
```

**[Recommended]** `service_price` rows are **never updated**. A price change inserts a new row
and closes the previous one's `valid_to`. This is what makes back-dated billing correct — and
**[Confirmed]** what the reference project cannot do, because its coverage and price lookups use
`nowdate()` (*../04-modules/healthcare-insurance.md*§3.1).

---

## 4. M4 — Payers

```sql
CREATE TABLE payer (
  id UUID PRIMARY KEY, clinic_id UUID NOT NULL REFERENCES clinic(id),
  payer_type TEXT NOT NULL CHECK (payer_type IN ('SELF_PAY','INSURER','CORPORATE')),
  code TEXT NOT NULL, name TEXT NOT NULL,
  ar_account_id UUID NOT NULL REFERENCES account(id),   -- ◄ own control account
  default_price_list_id UUID REFERENCES price_list(id),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (clinic_id, code)
);

CREATE TABLE payer_contract (
  id UUID PRIMARY KEY, payer_id UUID NOT NULL REFERENCES payer(id),
  code TEXT NOT NULL,
  price_list_id UUID REFERENCES price_list(id),
  valid_from DATE NOT NULL, valid_to DATE NOT NULL,
  claim_submission_days SMALLINT, payment_terms_days SMALLINT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  CHECK (valid_to >= valid_from)
);

CREATE TABLE payer_plan (
  id UUID PRIMARY KEY, payer_id UUID NOT NULL REFERENCES payer(id),
  contract_id UUID NOT NULL REFERENCES payer_contract(id),
  code TEXT NOT NULL, name TEXT NOT NULL,
  annual_benefit_cap_minor BIGINT,
  annual_deductible_minor  BIGINT,
  out_of_pocket_max_minor  BIGINT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE coverage_rule (
  id UUID PRIMARY KEY, plan_id UUID NOT NULL REFERENCES payer_plan(id),
  match_type TEXT NOT NULL CHECK (match_type IN ('SERVICE','CATEGORY','CODE','ALL')),
  service_id UUID REFERENCES service(id),
  category_id UUID REFERENCES service_category(id),
  medical_code TEXT,
  priority SMALLINT NOT NULL,                    -- explicit, not implicit
  is_excluded BOOLEAN NOT NULL DEFAULT FALSE,
  coverage_pct NUMERIC(5,2) CHECK (coverage_pct BETWEEN 0 AND 100),
  copay_fixed_minor BIGINT, copay_pct NUMERIC(5,2),
  requires_preauth BOOLEAN NOT NULL DEFAULT FALSE,
  valid_from DATE NOT NULL, valid_to DATE,        -- ◄ BOTH enforced at lookup
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX cr_lookup_idx ON coverage_rule (plan_id, match_type, valid_from) WHERE is_active;

CREATE TABLE patient_coverage (
  id UUID PRIMARY KEY, clinic_id UUID NOT NULL REFERENCES clinic(id),
  patient_id UUID NOT NULL,
  plan_id UUID NOT NULL REFERENCES payer_plan(id),
  policy_number TEXT NOT NULL, member_number TEXT,
  valid_from DATE NOT NULL,                       -- ◄ the reference project has no start date
  valid_to DATE NOT NULL,
  priority SMALLINT NOT NULL DEFAULT 1,           -- primary / secondary payer
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  CHECK (valid_to >= valid_from)
);
CREATE INDEX pc_patient_idx ON patient_coverage (patient_id, valid_from, valid_to)
  WHERE is_active;

CREATE TABLE benefit_accumulator (
  id UUID PRIMARY KEY,
  patient_id UUID NOT NULL, plan_id UUID NOT NULL REFERENCES payer_plan(id),
  benefit_year SMALLINT NOT NULL,
  deductible_met_minor BIGINT NOT NULL DEFAULT 0,
  out_of_pocket_minor  BIGINT NOT NULL DEFAULT 0,
  benefit_used_minor   BIGINT NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,             -- optimistic concurrency
  UNIQUE (patient_id, plan_id, benefit_year)
);

CREATE TABLE preauthorization (
  id UUID PRIMARY KEY, clinic_id UUID NOT NULL REFERENCES clinic(id),
  patient_id UUID NOT NULL, payer_id UUID NOT NULL REFERENCES payer(id),
  service_id UUID REFERENCES service(id),
  auth_number TEXT NOT NULL, approved_units NUMERIC(12,3), used_units NUMERIC(12,3) DEFAULT 0,
  valid_from DATE NOT NULL, valid_to DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('REQUESTED','APPROVED','DENIED','EXPIRED','USED')),
  UNIQUE (clinic_id, auth_number)
);
```

---

## 5. M6 — Charge capture

```sql
CREATE TABLE charge (
  id UUID PRIMARY KEY,
  clinic_id UUID NOT NULL REFERENCES clinic(id),
  branch_id UUID NOT NULL REFERENCES branch(id),
  patient_id UUID NOT NULL,
  encounter_id UUID,
  -- provenance
  source_type TEXT NOT NULL,
  source_id   UUID NOT NULL,
  service_id  UUID NOT NULL REFERENCES service(id),
  service_date DATE NOT NULL,
  -- amounts, resolved ONCE at capture
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  unit_price_minor BIGINT NOT NULL CHECK (unit_price_minor >= 0),
  gross_minor    BIGINT NOT NULL CHECK (gross_minor >= 0),
  discount_minor BIGINT NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  net_minor      BIGINT NOT NULL CHECK (net_minor >= 0),
  currency CHAR(3) NOT NULL REFERENCES currency(code),
  -- accounting targets, resolved at capture
  revenue_account_id UUID NOT NULL REFERENCES account(id),
  cost_center_id UUID NOT NULL REFERENCES cost_center(id),
  department_id UUID REFERENCES department(id),
  practitioner_id UUID,
  -- pricing provenance
  price_list_id UUID REFERENCES price_list(id),
  discount_policy_id UUID REFERENCES discount_policy(id),
  entitlement_id UUID,
  -- lifecycle
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN
          ('DRAFT','CAPTURED','INVOICED','VOIDED','WRITTEN_OFF')),
  captured_at TIMESTAMPTZ, captured_by UUID,
  void_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id, service_id),     -- ◄◄ kills duplicate billing
  CHECK (net_minor = gross_minor - discount_minor),
  CHECK (status <> 'VOIDED' OR void_reason IS NOT NULL)
);
CREATE INDEX charge_patient_idx ON charge (patient_id, service_date);
CREATE INDEX charge_status_idx  ON charge (clinic_id, status)
  WHERE status IN ('DRAFT','CAPTURED');            -- the unbilled work queue

CREATE TABLE charge_payer_split (
  id UUID PRIMARY KEY,
  charge_id UUID NOT NULL REFERENCES charge(id),
  payer_type TEXT NOT NULL CHECK (payer_type IN ('SELF_PAY','INSURER','CORPORATE')),
  payer_id UUID NOT NULL REFERENCES payer(id),
  amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
  basis TEXT NOT NULL CHECK (basis IN
        ('COVERAGE','COPAY','DEDUCTIBLE','EXCLUSION',
         'CONTRACTUAL_ADJUSTMENT','SELF_PAY')),
  coverage_rule_id UUID REFERENCES coverage_rule(id),
  invoice_line_id UUID UNIQUE,                     -- ◄◄ a split is invoiced AT MOST once
  claim_id UUID
);
CREATE INDEX cps_charge_idx ON charge_payer_split (charge_id);
CREATE INDEX cps_unbilled_idx ON charge_payer_split (payer_id)
  WHERE invoice_line_id IS NULL;
-- INVARIANT (integrity job): Σ amount_minor per charge = charge.net_minor

CREATE TABLE charge_status_history (           -- append-only
  id UUID PRIMARY KEY, charge_id UUID NOT NULL REFERENCES charge(id),
  from_status TEXT, to_status TEXT NOT NULL,
  reason TEXT, changed_at TIMESTAMPTZ NOT NULL DEFAULT now(), changed_by UUID NOT NULL
);

CREATE TABLE entitlement (
  id UUID PRIMARY KEY, clinic_id UUID NOT NULL REFERENCES clinic(id),
  patient_id UUID NOT NULL,
  practitioner_id UUID, service_id UUID REFERENCES service(id),
  kind TEXT NOT NULL CHECK (kind IN
        ('FREE_FOLLOW_UP','PACKAGE_SESSION','PREPAID_DEPOSIT')),
  granted_by_type TEXT, granted_by_id UUID,
  total_units NUMERIC(10,2) NOT NULL, consumed_units NUMERIC(10,2) NOT NULL DEFAULT 0,
  valid_from DATE NOT NULL, valid_to DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
         CHECK (status IN ('ACTIVE','EXHAUSTED','EXPIRED')),
  version INTEGER NOT NULL DEFAULT 0,
  CHECK (consumed_units <= total_units)            -- ◄ prevents over-consumption
);

CREATE TABLE entitlement_consumption (         -- append-only
  id UUID PRIMARY KEY,
  entitlement_id UUID NOT NULL REFERENCES entitlement(id),
  charge_id UUID NOT NULL REFERENCES charge(id) UNIQUE,
  units NUMERIC(10,2) NOT NULL, consumed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**The three constraints that do the real work:**

| Constraint | Prevents | Reference-project defect it fixes |
|---|---|---|
| `charge` `UNIQUE (source_type, source_id, service_id)` | A clinical act being charged twice | Emergency services re-billed indefinitely; concurrent invoicing both passing the `invoiced` check (*../04-modules/healthcare-billing.md*§7.1, §7.4) |
| `charge_payer_split.invoice_line_id UNIQUE` | A split appearing on two invoices | Cancelling *any* invoice freeing the clinical event (§7.5) |
| `entitlement` `CHECK (consumed_units <= total_units)` | Free-visit over-consumption | The reference project's three inconsistent Fee Validity checks (§6) |

---

## 6. M3 — Billing & AR

```sql
CREATE TABLE invoice (
  id UUID PRIMARY KEY,
  clinic_id UUID NOT NULL REFERENCES clinic(id),
  branch_id UUID NOT NULL REFERENCES branch(id),
  series TEXT NOT NULL, number BIGINT NOT NULL,     -- gapless, immutable
  payer_type TEXT NOT NULL, payer_id UUID NOT NULL REFERENCES payer(id),
  patient_id UUID NOT NULL,
  encounter_id UUID,
  issue_date DATE NOT NULL, due_date DATE NOT NULL,
  period_id UUID NOT NULL REFERENCES period(id),
  subtotal_minor BIGINT NOT NULL, discount_minor BIGINT NOT NULL DEFAULT 0,
  adjustment_minor BIGINT NOT NULL DEFAULT 0, tax_minor BIGINT NOT NULL DEFAULT 0,
  total_minor BIGINT NOT NULL,
  currency CHAR(3) NOT NULL REFERENCES currency(code),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN
         ('DRAFT','ISSUED','PARTIALLY_PAID','PAID','OVERDUE',
          'CREDITED','CANCELLED','WRITTEN_OFF')),
  journal_entry_id UUID REFERENCES journal_entry(id),
  cancel_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by UUID NOT NULL,
  UNIQUE (clinic_id, series, number)
  -- NOTE: no `outstanding_minor` column. Outstanding is DERIVED.
);
CREATE INDEX inv_payer_idx ON invoice (payer_type, payer_id, status);
CREATE INDEX inv_patient_idx ON invoice (patient_id, issue_date);

CREATE TABLE invoice_line (
  id UUID PRIMARY KEY, invoice_id UUID NOT NULL REFERENCES invoice(id),
  line_no SMALLINT NOT NULL,
  charge_id UUID REFERENCES charge(id),
  charge_split_id UUID UNIQUE REFERENCES charge_payer_split(id),
  service_id UUID REFERENCES service(id),
  description TEXT NOT NULL,
  quantity NUMERIC(12,3) NOT NULL,
  unit_price_minor BIGINT NOT NULL,
  gross_minor BIGINT NOT NULL, discount_minor BIGINT NOT NULL DEFAULT 0,
  adjustment_minor BIGINT NOT NULL DEFAULT 0,
  net_minor BIGINT NOT NULL, tax_minor BIGINT NOT NULL DEFAULT 0,
  total_minor BIGINT NOT NULL,
  revenue_account_id UUID NOT NULL REFERENCES account(id),
  cost_center_id UUID NOT NULL REFERENCES cost_center(id),
  department_id UUID, practitioner_id UUID,
  UNIQUE (invoice_id, line_no)
);

CREATE TABLE credit_note (
  id UUID PRIMARY KEY, clinic_id UUID NOT NULL REFERENCES clinic(id),
  series TEXT NOT NULL, number BIGINT NOT NULL,
  invoice_id UUID NOT NULL REFERENCES invoice(id),
  issue_date DATE NOT NULL, period_id UUID NOT NULL REFERENCES period(id),
  total_minor BIGINT NOT NULL, currency CHAR(3) NOT NULL,
  reason_code TEXT NOT NULL,                        -- mandatory
  journal_entry_id UUID REFERENCES journal_entry(id),
  approved_by UUID,
  UNIQUE (clinic_id, series, number)
);

CREATE TABLE claim (
  id UUID PRIMARY KEY, clinic_id UUID NOT NULL REFERENCES clinic(id),
  charge_split_id UUID NOT NULL UNIQUE REFERENCES charge_payer_split(id),
  payer_id UUID NOT NULL REFERENCES payer(id),
  invoice_line_id UUID REFERENCES invoice_line(id),
  batch_id UUID,
  claimed_minor BIGINT NOT NULL,
  approved_minor BIGINT, denied_minor BIGINT,
  denial_code TEXT,
  disposition TEXT CHECK (disposition IN
    ('PATIENT_RESPONSIBILITY','APPEAL','WRITE_OFF','CONTRACTUAL_ADJUSTMENT')),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN
    ('DRAFT','SUBMITTED','ACKNOWLEDGED','APPROVED','PARTIALLY_APPROVED',
     'DENIED','APPEALED','PAID','CLOSED','CANCELLED')),
  preauth_id UUID REFERENCES preauthorization(id),
  submitted_at TIMESTAMPTZ, adjudicated_at TIMESTAMPTZ,
  -- ◄ a denied claim MUST have a disposition
  CHECK (status <> 'DENIED' OR disposition IS NOT NULL)
);
CREATE INDEX claim_followup_idx ON claim (payer_id, status, submitted_at);

CREATE TABLE claim_batch (
  id UUID PRIMARY KEY, clinic_id UUID NOT NULL REFERENCES clinic(id),
  payer_id UUID NOT NULL REFERENCES payer(id),
  period_from DATE NOT NULL, period_to DATE NOT NULL,
  total_claimed_minor BIGINT NOT NULL,
  submitted_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','SUBMITTED','ADJUDICATED','SETTLED'))
);

CREATE TABLE remittance (
  id UUID PRIMARY KEY, clinic_id UUID NOT NULL REFERENCES clinic(id),
  payer_id UUID NOT NULL REFERENCES payer(id),
  batch_id UUID REFERENCES claim_batch(id),
  received_date DATE NOT NULL,
  received_minor BIGINT NOT NULL, allocated_minor BIGINT NOT NULL DEFAULT 0,
  variance_minor BIGINT NOT NULL DEFAULT 0,
  external_reference TEXT,
  journal_entry_id UUID REFERENCES journal_entry(id)
);
```

**[Recommended] Note the absence of `outstanding_minor` on `invoice`.** It is derived:

```sql
CREATE VIEW invoice_balance AS
SELECT i.id AS invoice_id, i.total_minor,
       COALESCE(pa.allocated, 0) AS allocated_minor,
       COALESCE(cn.credited, 0)  AS credited_minor,
       i.total_minor - COALESCE(pa.allocated,0) - COALESCE(cn.credited,0)
         AS outstanding_minor
FROM invoice i
LEFT JOIN (SELECT invoice_id, SUM(amount_minor) allocated
           FROM payment_allocation WHERE reversed_at IS NULL
           GROUP BY invoice_id) pa ON pa.invoice_id = i.id
LEFT JOIN (SELECT invoice_id, SUM(total_minor) credited
           FROM credit_note GROUP BY invoice_id) cn ON cn.invoice_id = i.id;
```

**[Confirmed]** The reference project denormalises `outstanding_amount` onto the invoice,
rewritten by `update_outstanding_amt` on every settling GL row, without locking
(*../02-architecture/financial-architecture.md*§5.3).
It is the system's single largest consistency risk. If the view proves too slow, materialise it
on a schedule — never maintain it incrementally.

---

## 7. M2 — Cash & payments

```sql
CREATE TABLE payment (
  id UUID PRIMARY KEY, clinic_id UUID NOT NULL REFERENCES clinic(id),
  branch_id UUID NOT NULL REFERENCES branch(id),
  series TEXT NOT NULL, number BIGINT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('IN','OUT')),
  payer_type TEXT NOT NULL, payer_id UUID NOT NULL REFERENCES payer(id),
  patient_id UUID,
  method TEXT NOT NULL CHECK (method IN
         ('CASH','CARD','TRANSFER','WALLET','CHEQUE','GATEWAY')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency CHAR(3) NOT NULL REFERENCES currency(code),
  received_at TIMESTAMPTZ NOT NULL,
  period_id UUID NOT NULL REFERENCES period(id),
  shift_id UUID, bank_account_id UUID, gateway TEXT,
  external_reference TEXT,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN
         ('PENDING','SETTLED','FAILED','REVERSED')),
  journal_entry_id UUID REFERENCES journal_entry(id),
  UNIQUE (clinic_id, series, number),
  UNIQUE (clinic_id, idempotency_key),                       -- ◄ duplicate guard
  UNIQUE (clinic_id, gateway, external_reference)            -- ◄ webhook replay guard
);

CREATE TABLE payment_allocation (          -- append-only in effect
  id UUID PRIMARY KEY,
  payment_id UUID NOT NULL REFERENCES payment(id),
  invoice_id UUID NOT NULL REFERENCES invoice(id),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  allocated_at TIMESTAMPTZ NOT NULL DEFAULT now(), allocated_by UUID NOT NULL,
  reversed_at TIMESTAMPTZ, reversed_by UUID, reversal_reason TEXT,
  reverses_allocation_id UUID REFERENCES payment_allocation(id)
  -- reallocation = mark reversed + insert new. NEVER an UPDATE of amount.
);
CREATE INDEX pa_invoice_idx ON payment_allocation (invoice_id) WHERE reversed_at IS NULL;

CREATE TABLE patient_deposit (
  id UUID PRIMARY KEY, clinic_id UUID NOT NULL REFERENCES clinic(id),
  patient_id UUID NOT NULL,
  payment_id UUID REFERENCES payment(id),
  amount_minor BIGINT NOT NULL,
  applied_minor BIGINT NOT NULL DEFAULT 0, refunded_minor BIGINT NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL,
  held_account_id UUID NOT NULL REFERENCES account(id),
  status TEXT NOT NULL DEFAULT 'HELD' CHECK (status IN
         ('HELD','PARTIALLY_APPLIED','APPLIED','REFUNDED')),
  CHECK (applied_minor + refunded_minor <= amount_minor)
);

CREATE TABLE cashier_shift (
  id UUID PRIMARY KEY, clinic_id UUID NOT NULL REFERENCES clinic(id),
  branch_id UUID NOT NULL REFERENCES branch(id),
  till_id TEXT NOT NULL, cashier_id UUID NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL, closed_at TIMESTAMPTZ,
  opening_float_minor BIGINT NOT NULL DEFAULT 0,
  expected_minor BIGINT, counted_minor BIGINT, variance_minor BIGINT,
  variance_journal_entry_id UUID REFERENCES journal_entry(id),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED','RECONCILED'))
);

CREATE TABLE refund (
  id UUID PRIMARY KEY, clinic_id UUID NOT NULL REFERENCES clinic(id),
  patient_id UUID, payer_id UUID REFERENCES payer(id),
  invoice_id UUID REFERENCES invoice(id),
  credit_note_id UUID REFERENCES credit_note(id),
  deposit_id UUID REFERENCES patient_deposit(id),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  method TEXT NOT NULL, reason_code TEXT NOT NULL,
  approved_by UUID, payment_id UUID REFERENCES payment(id),
  journal_entry_id UUID REFERENCES journal_entry(id),
  status TEXT NOT NULL CHECK (status IN ('REQUESTED','APPROVED','PAID','REJECTED'))
);
```

---

## 8. Cross-cutting: audit

```sql
CREATE TABLE financial_audit_log (        -- append-only
  id BIGSERIAL PRIMARY KEY,
  clinic_id UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id UUID NOT NULL, actor_role TEXT, source_ip INET, session_id TEXT,
  operation TEXT NOT NULL,          -- 'INVOICE_ISSUED','PAYMENT_REVERSED',...
  entity_type TEXT NOT NULL, entity_id UUID NOT NULL,
  amount_minor BIGINT, currency CHAR(3),
  before_state JSONB, after_state JSONB,
  reason_code TEXT, approval_id UUID
);
CREATE INDEX fal_entity_idx ON financial_audit_log (entity_type, entity_id);
CREATE INDEX fal_actor_idx  ON financial_audit_log (actor_id, occurred_at);
-- same append-only trigger as the ledger
```

**[Confirmed]** The reference project relies on generic `track_changes` versioning, which the
Healthcare module bypasses entirely by writing billing state with `frappe.db.set_value`
(*../04-modules/healthcare-billing.md*§4). A dedicated
financial audit log written by the service layer cannot be bypassed the same way.

---

## 9. Index summary for the known query patterns

| Query | Index |
|---|---|
| Account balance as of a date | `journal_line(account_id)` + `journal_entry(clinic_id, posting_date)` |
| Party balance / AR ageing | `journal_line(party_type, party_id)` |
| Entries for a source document | `journal_entry(clinic_id, source_type, source_id)` |
| Idempotency lookup | `journal_entry(clinic_id, idempotency_key)` UNIQUE |
| Unbilled charges work queue | partial `charge(clinic_id, status) WHERE status IN ('DRAFT','CAPTURED')` |
| Unbilled splits by payer | partial `charge_payer_split(payer_id) WHERE invoice_line_id IS NULL` |
| Open invoices by payer | `invoice(payer_type, payer_id, status)` |
| Claim follow-up | `claim(payer_id, status, submitted_at)` |
| Coverage resolution | `coverage_rule(plan_id, match_type, valid_from) WHERE is_active` |
| Price resolution | `service_price(price_list_id, service_id, valid_from)` |
| Trace a ledger row to its charge | `journal_line(charge_id)` |

---

## Open questions / unverified

1. **PostgreSQL assumed.** Exclusion constraints (used for non-overlapping validity windows) and
   `ltree` are Postgres-specific. On MySQL/MariaDB, substitute triggers and a plain path column.
2. **Whether `clinic_id` is the tenancy boundary or a branch of one tenant** — see
   [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md)§1 Decision B. If branches are separate legal
   entities, `clinic_id` is the entity and `branch` becomes redundant.
3. **Multi-currency columns** are shown minimally (one `currency` per line). If genuine
   multi-currency is needed, add `amount_in_base_minor` and `exchange_rate` to `journal_line`
   per [clinic-accounting-model.md](clinic-accounting-model.md)§2.3.
4. **Clinical table names** (`patient_id`, `encounter_id`, `practitioner_id`) are referenced
   without FKs because the clinical schema is out of scope. Add the FKs once it exists.
5. **`tax_group_id`** on `service` is a placeholder; the tax schema is not designed here (Phase 11).
6. **Partitioning** of `journal_line` and `financial_audit_log` by period will eventually be
   needed; volume is unknown so it is not specified.
7. **`entitlement.CHECK (consumed_units <= total_units)`** prevents over-consumption but requires
   the update to be serialised — hence the `version` column for optimistic concurrency. The same
   applies to `benefit_accumulator`.
