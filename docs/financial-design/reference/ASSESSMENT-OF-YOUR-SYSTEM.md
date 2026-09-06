# Assessment of the financial layer in your project — Clinic-System

**Purpose**
An accurate assessment of the billing layer that actually exists in `C:\Users\el awael\Clinic-System`,
compared against the reference project (ERPNext-Healthcare), with the implementation plan corrected
to match reality rather than a greenfield project.

**Assessment date:** 2026-09-06
**What was read:** all of `apps/billing/` (models · services · enums), `tests/test_billing.py`,
and the integration point in `apps/appointments/services.py`

**How this relates to the rest of the documentation**
This is the only document that talks about **your project**. The other folders (`01` → `11`) describe
the **reference project**. The original plan in [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) was
written assuming a greenfield build — this document corrects it.

---

## Summary in two lines

> **Your billing layer is well written — noticeably better than ERPNext's healthcare layer.**
> **What is missing is not fixes — it is whole layers: double-entry accounting, payers, and returns.**

---

## 1. The stack

| | |
|---|---|
| Backend | **Django 5.2.8** + Django REST Framework 3.17 |
| Frontend | **React + TypeScript + Vite** |
| Auth | JWT (`djangorestframework-simplejwt`) |
| Database | **SQLite** (development) — `db.sqlite3` present with WAL |
| Background jobs | `django-q2` (ORM broker — no Redis) |
| Change tracking | `django-simple-history` ✅ |
| Tests | `pytest-django` |
| Apps | 18: `appointments · billing · encounters · medical_records · medications · procedures · radiology · referrals · reports · vital_signs · doctors · users · audit · notifications · reviews · core · ai_scribe` |

**A note on the database:** SQLite is fine for development, but **it will not do for accounting in
production** — it does not really support row locking (`SELECT FOR UPDATE` is ignored), which disables
the protection you have correctly written in `record_payment`. **[Recommended]** move to PostgreSQL
before production.

---

## 2. What you have — in detail

### The models (5)

| Model | Role | ERPNext equivalent |
|---|---|---|
| `ServiceItem` | Price catalog — `name`, `name_ar`, `item_type`, `default_price`, `is_active` | `Item` + `Item Price` |
| `Invoice` | The invoice — `patient`, `doctor`, `status`, `subtotal`, `discount`, `total`, `paid_amount`, `balance`, `currency` | `Sales Invoice` |
| `InvoiceItem` | Invoice line — `description`, `service_item`, `quantity`, `unit_price`, `line_total`, **`source_type`**, **`source_id`** | `Sales Invoice Item` plus the custom `reference_dt`/`reference_dn` fields |
| `Payment` | A payment — `invoice`, `amount`, `payment_method`, `reference`, `received_by` | `Payment Entry` |
| `FeeValidity` | Free-visit window | `Fee Validity` |

### Business logic (`services.py`, 227 lines)

Three entry points:
1. `handle_appointment_completed(appointment)` — called from `appointments.services.complete_appointment()`
2. `record_payment(...)`
3. `billing_report(period)`

---

## 3. Ten things you got **right** — where ERPNext got them wrong ✅

This is not flattery — it is a comparison against the code.

### ✅ 1. Money is `Decimal`, not `float`

```python
default_price = models.DecimalField(max_digits=10, decimal_places=2,
    validators=[MinValueValidator(Decimal("0.00"))])
```

ERPNext stores `decimal` but computes in `float`, and their insurance code uses `float()` and `* 0.01`
with no rounding control (*../11-analysis/weaknesses.md*§W1).

**The consequence on their side:** the posting engine is forced to tolerate a **0.50** difference on
every invoice (*../11-analysis/risks.md*§R8).

**On your side:** the problem **does not exist at all**. Phase 1 of the plan is **already done**.

### ✅ 2. Real row locking (`select_for_update`)

```python
invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)   # record_payment
validity = FeeValidity.objects.select_for_update().filter(...)      # handle_appointment_completed
```

**ERPNext has not a single lock** anywhere in `accounts/` or `healthcare/` — the only one in the
codebase is in the stock ledger (*../02-architecture/transactions-and-consistency.md*§3).

You understood the problem and applied the fix. ⚠️ **But it is disabled on SQLite** — see §4.9.

### ✅ 3. `@transaction.atomic` on both financial operations

Both are wrapped. ERPNext has **13 explicit `commit()` calls** in the middle of financial operations,
breaking transaction boundaries (″§2).

### ✅ 4. `paid_amount` is recomputed from scratch, not incremented

```python
invoice.paid_amount = invoice.payments.aggregate(s=Sum("amount"))["s"] or Decimal("0.00")
```

This is **self-healing**. If it ever goes wrong once, the next payment corrects it.

ERPNext does the same thing but **without a lock**, so it drifts
(*../11-analysis/risks.md*§R10). You have the lock.

### ✅ 5. `balance` and `line_total` are computed in `save()`

```python
def save(self, *args, **kwargs):
    self.balance = (self.total or Decimal("0.00")) - (self.paid_amount or Decimal("0.00"))
    if "update_fields" in kwargs and kwargs["update_fields"] is not None:
        kwargs["update_fields"] = list(set(kwargs["update_fields"]) | {"balance"})
```

The `update_fields` handling is **smart** — it guarantees the derived field is not skipped even on a
partial save. And there is a test for it (`test_balance_recomputed_even_with_update_fields`).

### ✅ 6. `F("used_count") + 1` — an atomic increment

```python
validity.used_count = F("used_count") + 1
```

Not `used_count += 1` in Python. Correct.

### ✅ 7. A payment cannot exceed the balance

There is a check plus a test (`test_overpayment_rejected`). *(Though this creates a different problem — §4.3.)*

### ✅ 8. `on_delete=PROTECT` on the patient and on the invoice in `Payment`

You cannot delete a patient who has invoices, nor an invoice that has payments. ERPNext allows general
ledger entries to be deleted when a particular setting is enabled (*../11-analysis/risks.md*§R11).

### ✅ 9. The ERPNext free-visit bug **did not carry over**

In ERPNext, a new patient's first visit **passes without an invoice** and **also consumes a free visit**
(″§R26).

Yours: `handle_appointment_completed` looks for a valid window → **finds none** → **issues an invoice** ✅
→ then opens a new window with `used_count = 0`.

**The first visit is billed correctly.** The bug did not carry over. 👏

### ✅ 10. 27 billing tests

`tests/test_billing.py` — 391 lines, 27 tests, covering permissions, partial payment, free visits and
duplicate prevention.

ERPNext: its healthcare layer has **64 of 78 test files empty**, and `healthcare/utils.py` (1,156 lines)
**has no test file at all** (*../10-testing/coverage-gaps.md*).

---

## 4. What needs work — ordered by risk

### 🔴 4.1 The duplicate check is not backed by a database constraint

**The code:**
```python
existing = InvoiceItem.objects.filter(
    source_type=BillingSourceType.APPOINTMENT, source_id=appointment.id
).select_related("invoice").first()
if existing is not None:
    return existing.invoice, None
```

**The problem:** this is **check-then-act**. It is inside `@transaction.atomic`, but:
- there is no `select_for_update()` on this query
- there is no `UniqueConstraint` in the database — **confirmed: `grep -rn "UniqueConstraint\|unique_together" apps/billing/` returns nothing**

**Scenario:** two concurrent requests completing the same appointment (a double click, or a network
retry) → both read "no invoice" → both create one → **the patient is billed twice**.

**This is exactly** *../11-analysis/risks.md*§R6 from ERPNext.

**The fix — two lines:**
```python
class InvoiceItem(TimeStampedModel):
    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["source_type", "source_id"],
                condition=models.Q(source_id__isnull=False),
                name="uniq_invoice_item_source",
            )
        ]
```
plus a migration. After that the database refuses duplicates, not the code.

### 🔴 4.2 No double-entry accounting at all

**Confirmed:** `grep -rliE "journal|ledger|debit|credit"` across `apps/` returns only `audit` and
`core` — neither related to accounting.

So you have **invoices and payments**, but no **ledger**.

**Practical consequences:**

| You cannot produce | Why |
|---|---|
| A trial balance | No journal entries |
| An income statement (P&L) | No revenue and expense accounts |
| A balance sheet | No assets and liabilities |
| A cash flow statement | No cash accounts |
| A fiscal year close | No accounts to close |
| A hand-off to an external accountant | Not in the expected shape |
| Clinic expense tracking | No purchasing side at all |

`billing_report()` gives you **three numbers**: billed, collected, outstanding — plus a per-doctor split.
That is a good operational report, **but it is not accounting**.

**This is the biggest gap, and it is phases 1→3 of the plan.**

### 🟠 4.3 No returns, refunds or cancellation

**Confirmed from the code:**
```python
amount = models.DecimalField(..., validators=[MinValueValidator(Decimal("0.01"))])
```
so **a payment must be positive** — there is no negative payment.

And `record_payment` refuses when `amount > invoice.balance` — so **overpayment is impossible**.

And `InvoiceStatus` has `CANCELLED` and `VOID` — but **no logic** in `services.py` uses them.

**Scenarios that will happen in a real clinic and are not covered:**

| Scenario | What happens today |
|---|---|
| Patient pays 500 against a 450 invoice | ❌ the payment is refused |
| Patient paid and wants a refund | ❌ no path |
| Invoice raised by mistake | ❌ no cancellation |
| Discount after invoicing | ❌ no credit note |
| Deposit before a procedure | ❌ no such concept |
| Bad debt | ❌ no write-off |

**Important note:** refusing overpayment is a **defensible design decision** (it prevents mistakes), but
it needs an **alternative** — either a deposit or a patient credit. Right now reception simply hits a wall.

### 🟠 4.4 No insurance, no payers

What exists: `insurance_policy_number` on `PatientProfile` — **just a text field**.

**Entirely missing:**
- Insurers as an entity
- Contracts and coverage plans
- Coverage rules (what percentage of this service is covered)
- Splitting an invoice between patient and insurer
- Claims and claim follow-up
- Collection from the insurer

**Advice:** when you build this, **do not copy the ERPNext design**. They bill the patient in full and
then **post a correcting journal entry** — the source of 5 bugs
(*../04-modules/healthcare-insurance.md*§9).

The correct approach is in
[clinic-financial-modules.md](clinic-financial-modules.md)§4: **split at charge-creation time**.

### 🟠 4.5 Only appointments are billed

```python
class BillingSourceType(models.TextChoices):
    APPOINTMENT = "APPOINTMENT"
    LAB_ORDER = "LAB_ORDER"      # ← defined but unused
```

`handle_appointment_completed` is the **only** entry point. You have `procedures`, `radiology` and
`medications` apps — **none of them bill**.

Which means: radiology, lab, procedures and medications → **are never charged for**.

### 🟡 4.6 The invoice number is derived from `pk`

```python
@property
def number(self):
    return f"INV-{self.pk:05d}" if self.pk else "INV-(unsaved)"
```

**Two problems:**
1. **Not gapless** — any deleted invoice or failed transaction leaves a gap. Tax authorities generally
   require a gapless sequence.
2. **Database-dependent** — the numbers may differ after migrating to PostgreSQL.

**The fix:** a real `number` field with a `UniqueConstraint`, generated from a counter.

### 🟡 4.7 `FeeValidity`: the docstring contradicted the code — **resolved**

**The docstring says** (in two places):
> *"Free follow-up window opened when a consultation invoice is **fully paid**"*

**The code does:**
```python
invoice = Invoice.objects.create(... status=InvoiceStatus.ISSUED ...)   # not paid
InvoiceItem.objects.create(...)
invoice.recalculate_totals()
new_validity = FeeValidity.objects.create(...)   # ← created immediately
```

The window opens **when the invoice is issued**, not when it is paid.

**✅ Resolution: the code is right; the docstring is what gets corrected.**

The consultation fee buys an **episode of care** (visit + follow-ups within the window), so the
entitlement is created by the sale, not by the collection. Whether the patient has paid is a
receivables question, handled by an arrears warning at the point of use — not by withholding something
already paid for.

`tests/test_billing.py:186` asserts `invoice.status == InvoiceStatus.ISSUED` and then asserts the
window exists, so code and test already agree; the docstring line is the outlier.

See Task 2 in [`../FINANCIAL-ROADMAP.md`](../FINANCIAL-ROADMAP.md) for the full reasoning and the
concrete change.

### 🟡 4.8 The catalog bootstraps itself

```python
if item is None:
    item = ServiceItem.objects.create(
        name="General Consultation",
        default_price=Decimal(settings.BILLING_DEFAULT_CONSULTATION_PRICE),
    )
```

If `BILLING_DEFAULT_CONSULTATION_PRICE` is zero or wrong → **zero-value invoices with no warning at all**.
Close to *../11-analysis/risks.md*§R5.

### 🟡 4.9 SQLite disables your locks

**This is the most serious technical issue:** `select_for_update()` — which you wrote correctly in two
places — **is silently ignored by SQLite**.

So the protection you built **is not active today**. It will only work on PostgreSQL or MySQL.

---

## 5. Quick comparison: you vs ERPNext

| Item | ERPNext-Healthcare | Your project | Better |
|---|---|---|---|
| Money type | decimal storage / **float arithmetic** | **Decimal throughout** | 🟢 **you** |
| Debit/credit tolerance | **0.50** | N/A (no entries) | — |
| Row locking | **none anywhere** | `select_for_update` ×2 | 🟢 **you** |
| Transaction boundaries | 13 explicit commits | clean `@transaction.atomic` | 🟢 **you** |
| Duplicate-billing prevention | check with no constraint | check with no constraint | 🟡 **both** |
| 24-hour admission bug | **present** | N/A | 🟢 **you** |
| First-free-visit bug | **present** | **did not carry over** ✅ | 🟢 **you** |
| Billing tests | ~zero effective | **27 tests** | 🟢 **you** |
| **Double-entry accounting** | **present and solid** | ❌ absent | 🔴 **them** |
| **Chart of accounts** | present | ❌ absent | 🔴 **them** |
| **Financial statements** | 45 reports | 3 numbers | 🔴 **them** |
| **Returns and refunds** | present | ❌ absent | 🔴 **them** |
| **Purchasing and expenses** | present | ❌ absent | 🔴 **them** |
| Insurance | present (but broken) | ❌ absent | 🟡 |

**Conclusion:** your code is **cleaner and safer**. But its scope is **much narrower** — you have
billing, not a financial system.

---

## 6. The plan, adjusted to your project

The original plan had 17 phases for a greenfield build. Adjusted:

| Original phase | Status in your project | Work required |
|---|---|---|
| **P0** Decisions | 🟠 partial | Decide: PostgreSQL? branches? currencies? |
| **P1** Money | ✅ **done** | `Decimal` already in place ✅ |
| **P2** Chart of accounts | 🔴 **from scratch** | New `accounting` app |
| **P3** Posting engine | 🔴 **from scratch** | ⚠️ **the most important phase** |
| **P4** Pricing | 🟠 **60%** | You have `ServiceItem`; missing dated prices + per-payer price lists |
| **P5** Payers | 🔴 **from scratch** | Insurance + companies |
| **P6** Charge capture | 🟠 **redesign** | You have `source_type/id`; needs a standalone `Charge` model |
| **P7** Invoicing | ✅ **70%** | Foundation exists; missing the ledger wiring |
| **P8** Payments | ✅ **70%** | Missing deposits + cashier shifts |
| **P9** Returns | 🔴 **from scratch** | ⚠️ **the priority after accounting** |
| **P10** Claims | 🔴 from scratch | After P5 |
| **P11** Taxes | 🔴 from scratch | Per local law |
| **P12** Purchasing | 🔴 from scratch | If needed |
| **P13** Close and reports | 🔴 from scratch | After P3 |
| **P14** Security | 🟠 partial | You have permissions + `simple-history` |
| **P15** Integrations | 🟠 depends | Payment gateways? |
| **P16** Revenue integrity | 🔴 from scratch | Monitoring jobs |

**So roughly 4 phases are already saved.** The real work is **P2, P3, P9, P5**.

---

## 7. Recommendations — in order

> These map directly onto the numbered tasks in [`../FINANCIAL-ROADMAP.md`](../FINANCIAL-ROADMAP.md),
> which is the executable version of this section.

### 🔴 Right now (about an hour, prevents duplicate billing)

**1. Add a `UniqueConstraint` to `InvoiceItem`** — §4.1 → Roadmap Task 1
**2. Fix the `FeeValidity` docstring and add an arrears warning** — §4.7 → Roadmap Task 2

### 🔴 Before production (mandatory)

**3. Move to PostgreSQL** — without it your locks do nothing (§4.9) → Roadmap Task 3
**4. A real invoice number** instead of `pk` (§4.6) → Roadmap Task 14

### 🟠 The big part — in order

**5. The accounting layer** (P2 + P3): an `accounting` app with `Account`, `JournalEntry`,
`JournalLine` and `PostingService`. Billing calls it, never the other way round.
→ Roadmap Tasks 4, 5, 6

**6. Returns and refunds** (P9): credit note + refund + cancellation + deposit. → Roadmap Task 7

**7. The remaining billing sources**: radiology, lab, procedures, medications (§4.5). → Roadmap Task 8

**8. Insurance** (P5 + P10): **with the correct design** — split at charge time, not a correcting entry.
→ Roadmap Task 10

---

## 8. Which documents to read

| For | Read |
|---|---|
| Accounting (P2/P3) | [clinic-accounting-model.md](clinic-accounting-model.md) + [clinic-chart-of-accounts.md](clinic-chart-of-accounts.md) |
| The entry for each event | [clinic-accounting-events.md](clinic-accounting-events.md) |
| The Charge model | [clinic-financial-modules.md](clinic-financial-modules.md)§2 |
| Insurance | ″§4 + *../04-modules/healthcare-insurance.md*§9 (the bugs) |
| Returns | *../03-accounting/reversals-and-adjustments.md* |
| The schema | [clinic-data-model.md](clinic-data-model.md) *(written as PostgreSQL — translate to Django models)* |

---

## Open questions / unverified

1. **`apps/billing/views.py`, `permissions.py`, `serializers.py`** — not read. This assessment is based
   on the models, services and tests.
2. **Your existing plans** — `CLINIC_SYSTEM_IMPLEMENTATION_PLAN.md` and
   `production-readiness-audit-2026-08-15.md` were not read. They may cover things noted here.
3. **`apps/audit`** — appeared in a "ledger" search but its role was not confirmed.
4. **`apps/reports`** — may contain financial reports beyond `billing_report`.
5. **The frontend** — not examined at all.
6. **Migrations** — the change history of the billing app was not read.
