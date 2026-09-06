# Financial Roadmap — Clinic-System

> **Start here.** This document is written specifically for Clinic-System (Django 5.2 + DRF).
> It is not a generic plan — it is based on reading the code that actually exists in `apps/billing/`.

**Last updated:** 2026-09-06
**Basis:** full analysis of ERPNext-Healthcare as a reference system, plus a complete read of `apps/billing`

---

## ⚠️ Read this first — binding rules

**For any session (or developer) executing from this document:**

### ✅ What already exists and works — **do not touch it**

| Thing | Status | Why |
|---|---|---|
| `DecimalField` for money | ✅ **correct** | Do not convert to integer minor units. `Decimal` is right and working |
| `select_for_update()` in `record_payment` and `handle_appointment_completed` | ✅ **correct** | Do not remove |
| `@transaction.atomic` | ✅ **correct** | Do not remove |
| `paid_amount` recomputed from `Sum("amount")` | ✅ **correct** | Do not turn it into `+=` |
| `balance` computed in `save()` with `update_fields` handling | ✅ **correct** | This logic is right and covered by tests |
| `F("used_count") + 1` | ✅ **correct** | Atomic increment |
| `on_delete=PROTECT` on patient and invoice | ✅ **correct** | |
| The 27 tests in `tests/test_billing.py` | ✅ **must stay green** | A task that breaks them is a wrong task |

### 🚫 Forbidden

- ❌ **No `float`** in financial code — `Decimal` only
- ❌ **Never edit or delete a posted journal entry** — correct by reversing
- ❌ **No writes to the ledger** outside `PostingService`
- ❌ **Do not rebuild** anything listed in the "works already" table above
- ❌ **Do not execute more than one task per session** without review in between

### 📏 Execution rules

1. **One task per session.** Finish it, run the tests, commit, stop.
2. **Tests before you claim it is done** — the whole `pytest` suite green.
3. **Every task has a Definition of Done** — walk it item by item.
4. **If something is unclear, ask.** Do not guess in financial code.

---

## 1. Current state — what you have

### Models in `apps/billing/models.py`

```
ServiceItem    price catalog (name, name_ar, item_type, default_price, is_active)
Invoice        the invoice (patient, doctor, status, subtotal, discount, total,
                            paid_amount, balance, currency)
InvoiceItem    invoice line (description, service_item, quantity, unit_price,
                             line_total, source_type, source_id)
Payment        a payment (invoice, amount, payment_method, reference, received_by)
FeeValidity    free-follow-up window (patient, doctor, invoice,
                                      valid_from, valid_until, used_count, max_free_visits)
```

### Services in `apps/billing/services.py`

```
handle_appointment_completed(appointment)   ← called from appointments.services
record_payment(invoice, amount, ...)
billing_report(period)
```

### Scope gaps

| Layer | Status |
|---|---|
| Price catalog | ✅ exists (basic) |
| Invoicing | ✅ exists (appointments only) |
| Payments | ✅ exists |
| Free follow-ups | ✅ exists |
| **Double-entry accounting** | 🔴 **absent** |
| **Credit notes / refunds / cancellation** | 🔴 **absent** |
| **Payers / insurance** | 🔴 **absent** |
| **Billing for radiology / lab / procedures / medications** | 🔴 **absent** |
| **Purchasing and expenses** | 🔴 **absent** |

---

## 2. The tasks — in order

The order is deliberate. Tasks 1→3 protect what exists. 4→9 build the accounting core. 10+ extend it.

---

## 🔴 Task 1 — Unique constraint to stop duplicate billing

**Size:** small (~1 hour) · **Risk if deferred:** high

### The problem

`apps/billing/services.py::handle_appointment_completed`:

```python
existing = InvoiceItem.objects.filter(
    source_type=BillingSourceType.APPOINTMENT, source_id=appointment.id
).select_related("invoice").first()
if existing is not None:
    return existing.invoice, None
```

This is **check-then-act**. It runs inside `@transaction.atomic`, but:
- the query has no `select_for_update()`
- **there is no `UniqueConstraint` in the database**

Two concurrent requests for the same appointment (a double click, a retry) both read "not there"
→ **two invoices for one consultation**.

### What to do

**1. Add the constraint** — `apps/billing/models.py`:

```python
class InvoiceItem(TimeStampedModel):
    ...
    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(
                fields=["source_type", "source_id"],
                condition=models.Q(source_id__isnull=False),
                name="uniq_invoice_item_source",
            ),
        ]
```

> **Note:** the `source_id__isnull=False` condition matters — manual lines (with no source) must
> stay repeatable.

**2. Generate the migration** — `python manage.py makemigrations billing`

> ⚠️ If duplicate data already exists the migration will fail. Detect it first:
> ```python
> InvoiceItem.objects.exclude(source_id=None).values(
>     "source_type", "source_id"
> ).annotate(n=Count("id")).filter(n__gt=1)
> ```

**3. Catch the exception** in `handle_appointment_completed`:

```python
from django.db import IntegrityError

try:
    invoice = Invoice.objects.create(...)
    InvoiceItem.objects.create(..., source_id=appointment.id)
except IntegrityError:
    # Race: another request won. Return its invoice.
    existing = InvoiceItem.objects.filter(
        source_type=BillingSourceType.APPOINTMENT, source_id=appointment.id
    ).select_related("invoice").first()
    return existing.invoice, None
```

### ✅ Definition of Done

- [ ] `UniqueConstraint` in `Meta`, migration generated and applied
- [ ] `IntegrityError` caught and the existing invoice returned (not a 500)
- [ ] New test: creating a second `InvoiceItem` with the same `(source_type, source_id)` raises `IntegrityError`
- [ ] New test: `handle_appointment_completed` twice in a row → **one invoice** (existing test `test_recompleting_same_appointment_does_not_double_bill` must stay green)
- [ ] All 27 billing tests green

---

## 🟠 Task 2 — Fix the `FeeValidity` contradiction and add an arrears check

**Size:** small (1–2 hours) · **Risk:** medium

### The problem

**The docstring says** (`models.py:180` and `services.py`):
> *"Free follow-up window opened when a consultation invoice is **fully paid**"*

**The code does:** the window opens when the invoice is **issued**, while it is still `ISSUED` (unpaid).

### ✅ Decision: the code is right — the docstring is what gets fixed

**Reason:** the consultation fee does not buy one visit — it buys an **episode of care**
(the visit plus follow-ups within `BILLING_FOLLOWUP_DAYS`). The follow-up is **already paid for**
inside the consultation fee; it is not a reward for paying.

The clinic's obligation is created when the service is delivered (accrual), not when the cash
arrives. "Has the patient paid?" is a **receivables** question, not an **entitlement** question —
conflating the two undermines the very principle Tasks 4–6 are built on.

**Evidence from the code itself:** `tests/test_billing.py:186` asserts
`invoice.status == InvoiceStatus.ISSUED` and then asserts the window exists, with the comment
*"A fresh free-follow-up window opens with the invoice."* Code and test agree with each other;
the docstring line is the outlier.

> ⚠️ **Trap if anyone moves it to `record_payment` anyway:** `valid_from=today` would become the
> **payment** date. A patient seen on day 1 who pays on day 5 gets a window of 5→19 instead of
> 1→15 — four extra days as a reward for paying late. It would have to be anchored to
> `invoice.invoice_date`. That fact is itself evidence that the window belongs to the **visit
> date**, not the payment date.

### What to do

**1. Fix the docstring** in `models.py` and `services.py`:

```python
class FeeValidity(TimeStampedModel):
    """Free follow-up window opened when a consultation invoice is *issued*.

    The consultation fee buys an episode of care (visit + follow-ups within
    BILLING_FOLLOWUP_DAYS), so the entitlement is created by the sale, not by
    the collection. Whether the invoice is paid is a receivables concern —
    see the arrears check in `handle_appointment_completed`.
    """
```

**2. Arrears check — at the point of use, not at creation.**

In `handle_appointment_completed`, when a free visit is consumed, look for overdue invoices for
the same patient:

```python
overdue = Invoice.objects.filter(
    patient=patient_user,
    status__in=(InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID),
    due_date__lt=today,
).aggregate(total=Sum("balance"))["total"] or Decimal("0.00")
```

**Do not refuse the visit.** Return the figure alongside the result so the UI can warn reception:
> "This patient owes 50 EGP from 20/08"

The receptionist decides. The billing engine does not silently refuse.

### ✅ Definition of Done

- [ ] The docstring in both places describes the real behaviour (issued, not paid) and explains why
- [ ] Test: an **unpaid** invoice → the window **does** open (documents the intended behaviour explicitly)
- [ ] The arrears figure is computed and available to the UI when a free visit is consumed
- [ ] A free visit is **never refused** because of arrears — warning only
- [ ] Test: patient with arrears + free visit → visit proceeds **and** the warning is present
- [ ] All 27 billing tests green

---

## 🔴 Task 3 — Migrate to PostgreSQL

**Size:** medium (half a day) · **Risk if deferred:** 🔴 **very high**

### The problem

`select_for_update()` — which you wrote **correctly** in two places — is **silently ignored by
SQLite**.

Which means **the protection in the code is not actually active today.**

On top of that, Tasks 4→9 (accounting) need `CHECK` constraints and partial unique indexes, which
SQLite supports poorly.

### What to do

1. `psycopg[binary]` in `requirements.txt`
2. `DATABASES` reading from `django-environ` (already in the project)
3. Docker Compose for a dev Postgres (or a local install)
4. `python manage.py migrate` on a clean database
5. Full `pytest`
6. A data migration script if there is production data worth keeping

### ✅ Definition of Done

- [ ] The whole test suite green on PostgreSQL
- [ ] `dev.ps1` starts Postgres
- [ ] `SERVER_INFO.md` / the deployment plan updated
- [ ] SQLite kept only for fast local test runs (optional)

---

## 🟠 Task 4 — The accounting app: accounts and periods

**Size:** medium (one day) · **Depends on:** Task 3

📖 **Read first:** [`reference/clinic-accounting-model.md`](reference/clinic-accounting-model.md)§4, §7
and [`reference/clinic-chart-of-accounts.md`](reference/clinic-chart-of-accounts.md)

### What to do

A new app: `apps/accounting/`

```python
# apps/accounting/models.py

class Account(TimeStampedModel):
    """A node in the chart of accounts."""
    code = models.CharField(max_length=20)           # immutable once used
    name = models.CharField(max_length=200)
    name_ar = models.CharField(max_length=200, blank=True)
    parent = models.ForeignKey("self", null=True, blank=True,
                               on_delete=models.PROTECT, related_name="children")
    root_type = models.CharField(max_length=12, choices=RootType.choices)
    account_type = models.CharField(max_length=32, choices=AccountType.choices,
                                    blank=True, db_index=True)
    is_group = models.BooleanField(default=False)     # groups are never posted to
    is_active = models.BooleanField(default=True)
    currency = models.CharField(max_length=8, default="EGP")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["code"], name="uniq_account_code")]


class AccountMap(TimeStampedModel):
    """purpose → account. Code asks by purpose, never by account code."""
    purpose = models.CharField(max_length=64, db_index=True)   # 'AR_PATIENT', 'CASH_TILL', ...
    qualifier = models.CharField(max_length=64, blank=True)    # e.g. service category
    account = models.ForeignKey(Account, on_delete=models.PROTECT)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["purpose", "qualifier"],
                                               name="uniq_account_map")]


class FiscalYear(TimeStampedModel):
    name, start_date, end_date, status   # OPEN / CLOSED


class Period(TimeStampedModel):
    fiscal_year, start_date, end_date
    status = ...  # OPEN / SOFT_CLOSED / CLOSED
```

**The enums** go in `apps/core/enums.py` (matching the existing convention):

```python
class RootType(models.TextChoices):
    ASSET = "ASSET", _("Asset")
    LIABILITY = "LIABILITY", _("Liability")
    INCOME = "INCOME", _("Income")
    EXPENSE = "EXPENSE", _("Expense")
    EQUITY = "EQUITY", _("Equity")


class AccountType(models.TextChoices):
    RECEIVABLE = "RECEIVABLE", _("Receivable")
    PAYABLE = "PAYABLE", _("Payable")
    CASH = "CASH", _("Cash")
    BANK = "BANK", _("Bank")
    INCOME = "INCOME", _("Income")
    EXPENSE = "EXPENSE", _("Expense")
    TAX = "TAX", _("Tax")
    PATIENT_DEPOSIT = "PATIENT_DEPOSIT", _("Patient deposit")
    CONTRACTUAL_ADJUSTMENT = "CONTRACTUAL_ADJUSTMENT", _("Contractual adjustment")
    WRITE_OFF = "WRITE_OFF", _("Write off")
    ROUND_OFF = "ROUND_OFF", _("Round off")
```

**Plus `management/commands/seed_chart_of_accounts.py`** — a ready-made clinic chart of accounts.
The full tree is in [`reference/clinic-chart-of-accounts.md`](reference/clinic-chart-of-accounts.md)§2.

### ✅ Definition of Done

- [ ] `Account` as a tree, with posting to group accounts refused
- [ ] `code` immutable once used (checked in `save()` or a signal)
- [ ] `report_type` derived from `root_type` (Asset/Liability/Equity → balance sheet, Income/Expense → P&L)
- [ ] `AccountMap` with `resolve(purpose, qualifier=None)` that **raises** when nothing matches
- [ ] Periods cannot overlap
- [ ] `seed_chart_of_accounts` works
- [ ] Tests: the tree, code immutability, refusing to post to a group, `resolve` raising

---

## 🔴 Task 5 — The ledger and the posting engine

**Size:** large (1–2 days) · **Depends on:** Task 4 · ⚠️ **the most important task in this document**

📖 **Read first:** [`reference/clinic-accounting-model.md`](reference/clinic-accounting-model.md)§3, §5, §8 (in full)

### What to do

```python
# apps/accounting/models.py

class JournalEntry(TimeStampedModel):
    """A journal entry — balanced and immutable."""
    entry_no = models.BigAutoField(...)          # recording order
    posting_date = models.DateField(db_index=True)
    period = models.ForeignKey(Period, on_delete=models.PROTECT)
    source_type = models.CharField(max_length=32)   # 'Invoice' / 'Payment' / ...
    source_id = models.PositiveIntegerField()
    idempotency_key = models.CharField(max_length=255)      # ← duplicate protection
    description = models.CharField(max_length=255)
    reason_code = models.CharField(max_length=64, blank=True)   # mandatory for corrections
    reverses = models.ForeignKey("self", null=True, blank=True,
                                 on_delete=models.PROTECT, related_name="reversed_by")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["idempotency_key"], name="uniq_je_idempotency"),
        ]
        indexes = [models.Index(fields=["source_type", "source_id"])]


class JournalLine(TimeStampedModel):
    entry = models.ForeignKey(JournalEntry, on_delete=models.PROTECT, related_name="lines")
    line_no = models.PositiveSmallIntegerField()
    account = models.ForeignKey(Account, on_delete=models.PROTECT)
    debit = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))
    credit = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))
    # Party (mandatory on receivable/payable accounts)
    party_type = models.CharField(max_length=16, blank=True)
    party_id = models.PositiveIntegerField(null=True, blank=True)
    # Dimensions
    doctor = models.ForeignKey(..., null=True, blank=True)
    department = models.ForeignKey(..., null=True, blank=True)
    # Traceability
    invoice_item = models.ForeignKey("billing.InvoiceItem", null=True, blank=True,
                                     on_delete=models.PROTECT)
    memo = models.CharField(max_length=255, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(check=Q(debit__gte=0) & Q(credit__gte=0),
                                   name="jl_non_negative"),
            models.CheckConstraint(
                check=(Q(debit=0) & ~Q(credit=0)) | (~Q(debit=0) & Q(credit=0)),
                name="jl_exactly_one_side"),      # ← exactly one side
        ]
```

### `PostingService` — the only door

```python
# apps/accounting/services.py

@transaction.atomic
def post(*, posting_date, source_type, source_id, description,
         lines, idempotency_key, reason_code=None, reverses=None, user):
    """
    The only way to write to the ledger.

    Each step raises — nothing is silently corrected:
      1. Idempotency — if the key exists, return the existing entry (no-op)
      2. At least two lines, exactly one side per line, every amount > 0
      3. Sum(debit) == Sum(credit) exactly (no tolerance)
      4. Accounts exist, are not groups, are active
      5. Party mandatory on RECEIVABLE/PAYABLE, forbidden elsewhere
      6. The period is open
      7. Save in one transaction
    """
```

### ⚠️ Critical — zero tolerance

```python
if total_debit != total_credit:
    raise ImbalancedEntry(f"debit {total_debit} != credit {total_credit}")
```

**Do not add a tolerance.** The reference system allows a **0.50** difference, and that hides real
bugs. You are on `Decimal`, so the arithmetic closes exactly.

### Blocking edits and deletes

```python
# apps/accounting/models.py
class JournalEntry(TimeStampedModel):
    def save(self, *args, **kwargs):
        if self.pk and not getattr(self, "_allow_internal_save", False):
            raise ImmutableLedgerError("journal entries are immutable — post a reversal instead")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ImmutableLedgerError("journal entries cannot be deleted")
```

**Plus a database-level guard** (a `RunSQL` migration) — a PostgreSQL trigger that rejects
UPDATE/DELETE. Two layers of protection.

### `ReversalService`

```python
@transaction.atomic
def reverse(entry, *, reason_code, posting_date=None, user):
    """A reversing entry — mirrored lines plus reverses=entry. The original is untouched."""
```

### `BalanceService`

```python
def account_balance(account, as_of=None, **dimensions) -> Decimal
def trial_balance(as_of=None) -> list          # must sum to zero
def party_balance(party_type, party_id, as_of=None) -> Decimal
```

### ✅ Definition of Done — every item needs a test

- [ ] **Exact balance** — any unbalanced entry is refused (property test with random amounts)
- [ ] **Idempotency** — the same `idempotency_key` twice → **one entry**
- [ ] ⚠️ **Concurrency test** — two threads with the same key → **one entry**
- [ ] **Immutability** — `save()` on an existing entry raises; `delete()` raises
- [ ] **One side** — a line with both debit and credit → `IntegrityError`
- [ ] **Party** — a receivable line with no party is refused
- [ ] **Period** — posting into a closed period is refused
- [ ] **Reversal** — the reversing entry is an exact mirror; reversing a reversal restores the position
- [ ] **Partial failure** — a failure on line 5 of 6 → **no line is written**
- [ ] **Trial balance = zero** over a large randomised dataset
- [ ] 🎯 **Every `apps/accounting` test passes without importing anything from `billing`**

---

## 🟠 Task 6 — Wire billing into accounting

**Size:** medium (one day) · **Depends on:** Task 5

📖 **Read first:** [`reference/clinic-accounting-events.md`](reference/clinic-accounting-events.md)§2, §3

### The entries

**On invoice issue** — key `Invoice:{id}:issue`:

| Account | Debit | Credit |
|---|---|---|
| `AR_PATIENT` (party: patient) | `invoice.total` | |
| `REVENUE_BY_CATEGORY[service type]` | | `item.line_total` per line |
| `DISCOUNT` *(when there is a discount)* | `invoice.discount` | |

> ⚠️ **Revenue is recorded gross with the discount as its own line** — not net.
> If you record net, **you can never tell how much discount was given.** The reference system makes
> exactly this mistake.

**On payment** — key `Payment:{id}:receipt`:

| Account | Debit | Credit |
|---|---|---|
| `CASH_TILL` / `BANK` / `GATEWAY_CLEARING` (by `payment_method`) | `payment.amount` | |
| `AR_PATIENT` (party: patient) | | `payment.amount` |

**On a free follow-up** — **no entry** (the service is free).
*(Optional: record the forgone value in `ENTITLEMENT_FORGONE` to measure what is being given away.)*

### How to wire it

```python
# apps/billing/services.py
from apps.accounting.services import post as post_entry

@transaction.atomic
def issue_invoice(invoice, *, user):
    ...
    post_entry(
        posting_date=invoice.invoice_date,
        source_type="Invoice", source_id=invoice.id,
        idempotency_key=f"Invoice:{invoice.id}:issue",
        description=f"Invoice {invoice.number}",
        lines=[...], user=user,
    )
```

> **Direction matters:** `billing` calls `accounting`. **`accounting` never calls `billing`.**

### ✅ Definition of Done

- [ ] Issuing an invoice posts a balanced entry
- [ ] Recording a payment posts a balanced entry
- [ ] **Revenue gross, discount as a separate line**
- [ ] The cash account varies by `payment_method`
- [ ] Test: the `AR_PATIENT` balance equals the sum of `balance` over open invoices
- [ ] Test: after a full scenario (visit → invoice → payment) **the trial balance is zero**
- [ ] The original 27 tests **still green**

---

## 🟠 Task 7 — Credit notes, refunds and cancellation

**Size:** medium-large (1–2 days) · **Depends on:** Task 6

📖 **Read first:** *reversals-and-adjustments* (in the analysis knowledge base)

### What is missing today

| Scenario | Today |
|---|---|
| Paying 500 against a 450 invoice | ❌ refused |
| Patient wants a refund | ❌ no path |
| Invoice raised by mistake | ❌ `CANCELLED` exists but has no logic behind it |
| Discount after invoicing | ❌ no credit note |
| Deposit / advance | ❌ none |

### What to do

```python
class CreditNote(TimeStampedModel):
    invoice = models.ForeignKey(Invoice, on_delete=models.PROTECT)
    amount = models.DecimalField(...)
    reason_code = models.CharField(max_length=64)        # mandatory
    approved_by = models.ForeignKey(...)
    journal_entry = models.ForeignKey("accounting.JournalEntry", ...)


class Refund(TimeStampedModel):
    patient, invoice, amount, method
    reason_code = models.CharField(max_length=64)        # mandatory
    approved_by, journal_entry


class PatientDeposit(TimeStampedModel):
    """Money taken in advance — a liability, not revenue."""
    patient, amount, applied_amount, refunded_amount, status
```

**Plus invoice cancellation** = a reversing entry + `status = CANCELLED`. **Never a delete.**

**Plus overpayment** goes to `PatientDeposit` instead of being refused.

### ✅ Definition of Done

- [ ] Full and partial credit notes post correctly
- [ ] A refund can **never exceed** what was collected
- [ ] Cancellation posts a reversal; the original is **unchanged**
- [ ] `reason_code` mandatory (at the database level)
- [ ] A deposit is a **liability**, not revenue
- [ ] Overpayment becomes a deposit
- [ ] After every scenario: **trial balance = zero**

---

## 🟡 Task 8 — The remaining billing sources

**Size:** medium · **Depends on:** Task 6

Today **only appointments** are billed. You have `procedures`, `radiology` and `medications` apps —
**none of them bill**.

- Extend `BillingSourceType` (`LAB_ORDER` is already defined and unused)
- A hook per source — **following the Task 1 pattern exactly** (unique constraint + `IntegrityError` handler)
- New `ServiceItemType` values: `RADIOLOGY`, `MEDICATION`

### ✅ Definition of Done

- [ ] Each source produces an invoice line exactly once
- [ ] Each source maps to an appropriate revenue account
- [ ] A duplicate-prevention test per source

---

## 🟡 Task 9 — Financial reports

**Size:** medium · **Depends on:** Task 6

- **Trial balance** (must be zero)
- **Income statement**
- **Balance sheet**
- **AR ageing** — derived from the ledger, not from `Invoice.balance`
- **Patient statement**

### ✅ Definition of Done

- [ ] Every report **reconciles** to the trial balance (automated test)
- [ ] The existing `billing_report()` **agrees** with the new reports

---

## ⚪ Later tasks

| # | Task | Note |
|---|---|---|
| 10 | **Payers and insurance** | 📖 [`reference/clinic-financial-modules.md`](reference/clinic-financial-modules.md)§4 — **split at charge time**, not with a correcting entry as the reference system does |
| 11 | **Cashier shifts** | Open/close plus **posting the till variance** |
| 12 | **Taxes** | Per Egyptian law |
| 13 | **Purchasing and expenses** | A `payables` app |
| 14 | **A real invoice number** | Currently derived from `pk`, so it has gaps. Tax rules require a gapless sequence |
| 15 | **Permissions and approvals** | Limits on refunds and write-offs |
| 16 | **Revenue-integrity jobs** | `django-q2` — **detect and report, never auto-correct** |

---

## 3. Quick reference

| You want | Read |
|---|---|
| **An assessment of your project** | [`reference/ASSESSMENT-OF-YOUR-SYSTEM.md`](reference/ASSESSMENT-OF-YOUR-SYSTEM.md) |
| The accounting model | [`reference/clinic-accounting-model.md`](reference/clinic-accounting-model.md) |
| The chart of accounts | [`reference/clinic-chart-of-accounts.md`](reference/clinic-chart-of-accounts.md) |
| The entry for each business event | [`reference/clinic-accounting-events.md`](reference/clinic-accounting-events.md) |
| Charge design and insurance | [`reference/clinic-financial-modules.md`](reference/clinic-financial-modules.md) |
| The whole picture | [`reference/implementation-blueprint.md`](reference/implementation-blueprint.md) |

> **Note:** the `reference/` documents are written against raw PostgreSQL/SQL because they were
> drafted for a greenfield system.
> **This roadmap is the authority for your project** — where they differ, the roadmap wins.

---

## 4. Working with Claude Code

**The right way to ask:**

```
Read docs/financial-design/FINANCIAL-ROADMAP.md and execute Task 1 only.
Do nothing else.
```

**The wrong way:**

```
Execute the plan        ← 50 files change and you cannot tell what happened
```

**After every task:** `pytest` → review the diff → commit → next task.
