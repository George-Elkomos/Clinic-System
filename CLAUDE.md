# Clinic-System

Clinic management system.
**Backend:** Django 5.2 + DRF + SimpleJWT + django-q2 + django-simple-history.
**Frontend:** React + TypeScript + Vite. **DB:** SQLite (dev) → PostgreSQL (production).

```
Backend/apps/       18 apps: ai_scribe appointments audit billing core doctors encounters
                    medical_records medications notifications procedures radiology
                    referrals reports reviews users vital_signs
Backend/tests/      all tests live here centrally (not inside each app)
Backend/clinic_project/settings/   base / dev / test / prod
```

## Commands

```bash
cd Backend
pytest                          # full suite (324 tests)
pytest tests/test_billing.py    # billing (27 tests)
python manage.py makemigrations
python manage.py migrate
```

From the repo root, `./dev.ps1` starts the dev environment.

---

# 🔴 Financial rules — binding

Any code that touches money (`billing`, `accounting`, `reports`, or anything holding an amount)
must follow these.

## 1. Money

- ✅ **Always `Decimal`** — `DecimalField(max_digits=10, decimal_places=2)`.
- ❌ **Never `float`** in a monetary calculation. Not even temporarily.
- ❌ **Do not convert money to integer minor units.** The existing `Decimal` approach is correct
  and working — leave it alone.
- Rounding is explicit, never implicit:
  `Decimal.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)`.
- ❌ **Never compare amounts with `==` after a division.** Distribute with a remainder so the
  parts sum back to the whole exactly.

## 2. The ledger (once `apps/accounting` exists)

- ❌ **No direct writes** to `JournalEntry` / `JournalLine`.
  The only door is `apps.accounting.services.post(...)`.
- ❌ **A posted entry is never edited.** `save()` on an existing entry must raise.
- ❌ **A posted entry is never deleted.** `delete()` must raise.
  **Corrections are made by posting a reversing entry** (`ReversalService.reverse`); the original
  stays exactly as it was.
- **Balance tolerance is zero:** `Σ debit == Σ credit` exactly. **Do not add a tolerance.**
- Each line carries **one side only** — debit or credit, never both.
- Every entry has a unique `idempotency_key`. Re-posting with the same key is a no-op.
- **Direction:** `billing` calls `accounting`. **`accounting` never calls `billing`.**

## 3. Concurrency

- Any mutation of an invoice or a balance: `select_for_update()` inside `@transaction.atomic`.
- ⚠️ **SQLite silently ignores `select_for_update()`.** These guards are not actually protecting
  anything until the PostgreSQL migration lands.
- **Check-then-act without a backing `UniqueConstraint` is a bug.** Any "create it if it doesn't
  exist" logic needs a database-level unique constraint plus an `IntegrityError` handler.
- Totals are recomputed with `aggregate(Sum(...))`, never `+=`. Counters use `F(...) + 1`.

## 4. Deletion and audit

- ❌ **Never delete** an invoice, a payment or a journal entry. Cancelling means a status change
  plus a reversing entry.
- `on_delete=PROTECT` on every financial FK — **not `CASCADE`**.
- Every financial correction requires a `reason_code` (enforced at the database level) and an
  `approved_by`.

## 5. Tests

- **The 27 tests in `tests/test_billing.py` must stay green.** A change that breaks them is a
  wrong change.
- New financial logic requires tests. No test means not done.
- After any financial scenario in a test, **the trial balance must equal zero**.

---

## The financial work plan

📖 **`docs/financial-design/FINANCIAL-ROADMAP.md`** is the authority.
Numbered tasks in a deliberate order, each with its own Definition of Done.

**Execute exactly one task per session.** Finish it → run `pytest` → review the diff → commit →
stop. Do not "execute the plan".

`docs/financial-design/reference/` holds the detailed design. It is written against raw SQL
because it was drafted for a greenfield system — **where it disagrees with the roadmap, the
roadmap wins.**

---

## General conventions

- Code and identifiers in English. User-facing documentation for the owner is in Arabic.
- Fields with an Arabic variant are named `name` + `name_ar`.
- All enums live in `apps/core/enums.py` — **do not define `choices` inline on a model**.
- Business logic lives in `apps/<app>/services.py`, not in views or serializers.
- Never generate a migration without reviewing its diff first.
- Never commit unless the user asks.
