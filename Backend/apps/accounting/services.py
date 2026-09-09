"""The posting engine (financial roadmap Task 5) — the ledger's one door.

`post()` is the only way any code may write a `JournalEntry`/`JournalLine`.
Every step either passes or raises; nothing is silently adjusted or
tolerated, per CLAUDE.md's financial rules (Decimal money, zero balance
tolerance, no direct ledger writes).

Nothing here imports from `apps.billing` — Task 5's own Definition of Done
requires this module (and its tests) to work with no clinical/billing
concept present. `billing` calls `post()`; `post()` never calls `billing`.
"""
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import Sum
from django.utils import timezone

from apps.core.enums import AccountType, PeriodStatus

from .exceptions import (
    ImbalancedEntryError,
    NoPeriodForDateError,
    PartyForbiddenError,
    PartyRequiredError,
    PeriodClosedError,
    ReasonCodeRequiredError,
    StructureError,
)
from .models import Account, JournalEntry, JournalLine, Period

_PARTY_ACCOUNT_TYPES = (AccountType.RECEIVABLE, AccountType.PAYABLE)


def _normalize_line(raw):
    account = raw["account"]
    if not isinstance(account, Account):
        account = Account.objects.get(pk=account)

    debit = Decimal(raw.get("debit") or "0.00")
    credit = Decimal(raw.get("credit") or "0.00")
    if debit < 0 or credit < 0:
        raise StructureError("A journal line's debit/credit cannot be negative.")
    if (debit == 0) == (credit == 0):
        raise StructureError(
            f"Line on {account.code} must have exactly one non-zero side "
            f"(debit={debit}, credit={credit})."
        )

    account.assert_postable()

    party_type = raw.get("party_type") or ""
    party_id = raw.get("party_id")
    is_party_account = account.account_type in _PARTY_ACCOUNT_TYPES
    if is_party_account and not (party_type and party_id):
        raise PartyRequiredError(
            f"{account.code} is a {account.account_type} account and requires a party."
        )
    if not is_party_account and (party_type or party_id):
        raise PartyForbiddenError(
            f"{account.code} is not a receivable/payable account and cannot carry a party."
        )

    return {
        "account": account,
        "debit": debit,
        "credit": credit,
        "party_type": party_type,
        "party_id": party_id,
        "doctor": raw.get("doctor"),
        "invoice_item": raw.get("invoice_item"),
        "memo": raw.get("memo") or "",
    }


@transaction.atomic
def post(
    *, posting_date, source_type, source_id, description, lines,
    idempotency_key, reason_code="", reverses=None, user,
):
    """The only way to write to the ledger. Returns the (possibly pre-existing)
    `JournalEntry` for `idempotency_key` — a retry is a no-op, never a duplicate."""
    existing = JournalEntry.objects.filter(idempotency_key=idempotency_key).first()
    if existing is not None:
        return existing

    if len(lines) < 2:
        raise StructureError("A journal entry needs at least two lines.")

    normalized = [_normalize_line(raw) for raw in lines]
    total_debit = sum((line["debit"] for line in normalized), Decimal("0.00"))
    total_credit = sum((line["credit"] for line in normalized), Decimal("0.00"))
    if total_debit != total_credit:
        raise ImbalancedEntryError(f"debit {total_debit} != credit {total_credit}")

    period = Period.for_date(posting_date)
    if period is None:
        raise NoPeriodForDateError(f"No period covers {posting_date}.")
    if period.status == PeriodStatus.CLOSED:
        raise PeriodClosedError(f"{period} is closed — post a reversal into an open period instead.")

    try:
        with transaction.atomic():
            entry = JournalEntry.objects.create(
                posting_date=posting_date,
                period=period,
                source_type=source_type,
                source_id=source_id,
                idempotency_key=idempotency_key,
                description=description,
                reason_code=reason_code or "",
                reverses=reverses,
                created_by=user,
            )
            for line_no, line in enumerate(normalized, start=1):
                JournalLine.objects.create(entry=entry, line_no=line_no, **line)
    except IntegrityError:
        # Race: another request posted the same idempotency_key first.
        return JournalEntry.objects.get(idempotency_key=idempotency_key)

    return entry


def reverse(entry, *, reason_code, posting_date=None, user):
    """Post a reversing entry: every line mirrored (sides swapped). The
    original entry is left completely untouched."""
    if not reason_code:
        raise ReasonCodeRequiredError("A reversal requires a reason_code.")

    mirrored_lines = [
        {
            "account": line.account,
            "debit": line.credit,
            "credit": line.debit,
            "party_type": line.party_type,
            "party_id": line.party_id,
            "doctor": line.doctor,
            "invoice_item": line.invoice_item,
            "memo": line.memo,
        }
        for line in entry.lines.order_by("line_no")
    ]
    return post(
        posting_date=posting_date or timezone.localdate(),
        source_type=entry.source_type,
        source_id=entry.source_id,
        description=f"Reversal of: {entry.description}",
        lines=mirrored_lines,
        idempotency_key=f"{entry.idempotency_key}:reverse",
        reason_code=reason_code,
        reverses=entry,
        user=user,
    )


def account_balance(account, as_of=None, **dimensions):
    """Σdebit − Σcredit for `account`, derived from the ledger (no cached column)."""
    qs = JournalLine.objects.filter(account=account)
    if as_of is not None:
        qs = qs.filter(entry__posting_date__lte=as_of)
    if dimensions:
        qs = qs.filter(**dimensions)
    agg = qs.aggregate(debit=Sum("debit"), credit=Sum("credit"))
    return (agg["debit"] or Decimal("0.00")) - (agg["credit"] or Decimal("0.00"))


def party_balance(party_type, party_id, as_of=None):
    """Σdebit − Σcredit for one party across every account (e.g. a patient's AR)."""
    qs = JournalLine.objects.filter(party_type=party_type, party_id=party_id)
    if as_of is not None:
        qs = qs.filter(entry__posting_date__lte=as_of)
    agg = qs.aggregate(debit=Sum("debit"), credit=Sum("credit"))
    return (agg["debit"] or Decimal("0.00")) - (agg["credit"] or Decimal("0.00"))


def trial_balance(as_of=None):
    """Every account's balance as of `as_of` (default: all time). Must sum to zero."""
    qs = JournalLine.objects.all()
    if as_of is not None:
        qs = qs.filter(entry__posting_date__lte=as_of)

    rows = list(
        qs.values("account_id", "account__code", "account__name")
        .annotate(debit=Sum("debit"), credit=Sum("credit"))
        .order_by("account__code")
    )
    result_rows = []
    total_debit = Decimal("0.00")
    total_credit = Decimal("0.00")
    for row in rows:
        debit = row["debit"] or Decimal("0.00")
        credit = row["credit"] or Decimal("0.00")
        total_debit += debit
        total_credit += credit
        result_rows.append({
            "account_id": row["account_id"],
            "account_code": row["account__code"],
            "account_name": row["account__name"],
            "debit": debit,
            "credit": credit,
            "balance": debit - credit,
        })

    return {
        "as_of": as_of,
        "rows": result_rows,
        "total_debit": total_debit,
        "total_credit": total_credit,
        "is_balanced": total_debit == total_credit,
    }
