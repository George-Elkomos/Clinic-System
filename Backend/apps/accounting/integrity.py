"""Financial roadmap Task 16 — detect-only revenue/ledger integrity checks.

`run_revenue_integrity_check()` is a pure, read-only service. It never calls
`accounting.services.post`/`reverse`, never calls any `billing.services`
mutation function, and never creates, updates, or deletes a financial record.
Every check here only ever *looks* and constructs a `Finding` describing what
it saw — correcting anything it finds is always a separate, human-approved
action. See the roadmap's own framing for this task: "detect and report,
never auto-correct."

Safe to call repeatedly, concurrently, from a shell, a test, the Django
admin, or (via `apps.accounting.tasks`) the scheduled django-q job — every
check is a plain SELECT, so there is nothing here that can corrupt data or
produce a different result just from being run twice.
"""
from __future__ import annotations

import logging
import re
from dataclasses import asdict, dataclass
from datetime import timedelta
from decimal import Decimal
from typing import Any

from django.db.models import Count, Sum
from django.db.models.functions import Coalesce
from django.utils import timezone

from apps.accounting.models import JournalEntry
from apps.billing import reports as billing_reports
from apps.billing.models import (
    CashierShift,
    CashMovement,
    CreditNote,
    IdempotentRequest,
    Invoice,
    InvoiceItem,
    InvoiceNumberSequence,
    Payment,
    Refund,
    WriteOff,
)
from apps.core.enums import (
    BillingSourceType,
    CashierShiftStatus,
    IdempotencyStatus,
    InvoiceStatus,
    LabOrderStatus,
    ProcedureStatus,
    RadiologyOrderStatus,
)
from apps.medical_records.models import LabOrder
from apps.procedures.models import ClinicalProcedure
from apps.radiology.models import RadiologyOrder

logger = logging.getLogger(__name__)

# How long an IdempotentRequest may sit IN_PROGRESS before it counts as stale
# (a crashed request that never rolled back) rather than one still
# legitimately mid-flight. Generous on purpose — see IdempotentRequest's own
# docstring: under normal operation this should never be observed at all.
STALE_IDEMPOTENT_REQUEST_AGE = timedelta(hours=1)

# source_type -> model, for every value apps/billing/services.py actually
# passes to `accounting.services.post(source_type=...)` today. A source_type
# not in this map is skipped by the orphan check, never guessed at.
#
# "WriteOff" covers both a write-off's own original posting AND its
# reversal — `accounting_services.reverse()` preserves the original entry's
# source_type/source_id (financial roadmap Task 15), so a reversal never
# emits a distinct "WriteOffReversal" source_type; adding one here would
# check for a source_type the ledger never actually produces.
_ORPHAN_SOURCE_MODELS: dict[str, Any] = {
    "Invoice": Invoice,
    "Payment": Payment,
    "CreditNote": CreditNote,
    "Refund": Refund,
    "CashierShift": CashierShift,
    "CashMovement": CashMovement,
    "WriteOff": WriteOff,
}

_INVOICE_NUMBER_RE = re.compile(r"^INV-(\d+)$")


@dataclass(frozen=True)
class Finding:
    """One integrity finding. Every field is a plain, JSON-serialisable
    value on purpose — see `as_dict()` and `run_revenue_integrity_check`'s
    own docstring for why."""

    category: str
    severity: str  # "critical" | "warning"
    object_type: str
    object_id: Any
    message: str

    def as_dict(self) -> dict:
        return asdict(self)


def _run_check(name, fn, *, findings, checks_run, checks_failed):
    """Run one check in isolation. A check that raises is recorded in
    `checks_failed` and skipped — it never aborts the ones after it."""
    checks_run.append(name)
    try:
        findings.extend(fn())
    except Exception:
        logger.exception(
            "Revenue integrity check %r raised an exception — skipping it, "
            "the remaining checks still ran.",
            name,
        )
        checks_failed.append(name)


def run_revenue_integrity_check() -> dict:
    """Run every check and return one structured, serialisation-friendly
    result. Never mutates anything — see the module docstring.

    Shape:
        {
            "ok": bool,                 # no critical findings AND no check failed
            "checked_at": "<isoformat>",
            "summary": {
                "total_findings": int, "critical": int, "warning": int,
                "checks_run": int, "checks_failed": int,
            },
            "findings": [ {category, severity, object_type, object_id, message}, ... ],
            "checks_failed": [ "<check name>", ... ],
        }
    """
    findings: list[Finding] = []
    checks_run: list[str] = []
    checks_failed: list[str] = []

    checks = (
        ("ledger_structure_and_balance", _check_ledger_structure_and_balance),
        ("invoice_ledger", _check_invoice_ledger),
        ("payment_ledger", _check_payment_ledger),
        ("correction_ledger", _check_correction_ledger),
        ("write_off_ledger", _check_write_off_ledger),
        ("idempotency_anomalies", _check_idempotency_anomalies),
        ("invoice_number_integrity", _check_invoice_number_integrity),
        ("cashier_integrity", _check_cashier_integrity),
        ("orphan_ledger_sources", _check_orphan_ledger_sources),
        ("invoice_write_off_aggregate", _check_invoice_write_off_aggregate),
        ("invoice_balance_non_negative", _check_invoice_balance_non_negative),
        ("unbilled_clinical_completions", _check_unbilled_clinical_completions),
        ("ar_reconciliation", _check_ar_reconciliation),
    )
    for name, fn in checks:
        _run_check(name, fn, findings=findings, checks_run=checks_run, checks_failed=checks_failed)

    critical = sum(1 for f in findings if f.severity == "critical")
    warning = sum(1 for f in findings if f.severity == "warning")

    return {
        "ok": critical == 0 and not checks_failed,
        "checked_at": timezone.now().isoformat(),
        "summary": {
            "total_findings": len(findings),
            "critical": critical,
            "warning": warning,
            "checks_run": len(checks_run),
            "checks_failed": len(checks_failed),
        },
        "findings": [f.as_dict() for f in findings],
        "checks_failed": list(checks_failed),
    }


# --- Individual checks -------------------------------------------------------
# Every function below is a pure read: it returns a list[Finding] and touches
# no other state. Each is called independently by run_revenue_integrity_check
# so one raising never stops the rest.


def _check_ledger_structure_and_balance() -> list[Finding]:
    """Every JournalEntry must have at least 2 lines (the exact minimum
    `accounting.services.post` enforces via StructureError — see
    test_accounting_ledger.py's own "one line" test) and Σdebit == Σcredit.

    A DB CheckConstraint only guards each *line* (non-negative, exactly one
    side) — nothing at the database level enforces that a whole entry's
    debits equal its credits, so this is a genuine check, not redundant
    defense-in-depth. A zero-line entry is deliberately checked *before* the
    balance comparison and reported once, structurally — it would otherwise
    look "balanced" (0 == 0) while being invalid.
    """
    findings: list[Finding] = []
    # One query: per-entry line count plus debit/credit totals, grouped by
    # entry id — no N+1 regardless of how many entries exist.
    rows = (
        JournalEntry.objects.values("id", "source_type", "source_id")
        .annotate(
            n_lines=Count("lines"),
            total_debit=_sum_or_zero("lines__debit"),
            total_credit=_sum_or_zero("lines__credit"),
        )
    )

    for row in rows:
        entry_id = row["id"]
        label = f"{row['source_type']}:{row['source_id']}"
        if row["n_lines"] < 2:
            findings.append(Finding(
                category="ledger_structure", severity="critical",
                object_type="JournalEntry", object_id=entry_id,
                message=(
                    f"JournalEntry {entry_id} ({label}) has {row['n_lines']} line(s) — "
                    "the posting contract requires at least 2."
                ),
            ))
            continue  # a structurally invalid entry isn't also evaluated for balance

        debit, credit = row["total_debit"], row["total_credit"]
        if debit != credit:
            findings.append(Finding(
                category="ledger_balance", severity="critical",
                object_type="JournalEntry", object_id=entry_id,
                message=(
                    f"JournalEntry {entry_id} ({label}) is unbalanced: "
                    f"debit={debit} credit={credit}."
                ),
            ))
    return findings


def _sum_or_zero(field):
    return Coalesce(Sum(field), Decimal("0.00"))


def _check_invoice_ledger() -> list[Finding]:
    """Every non-DRAFT Invoice must have exactly one *original* posting
    (`reverses IS NULL`). A CANCELLED invoice must additionally have exactly
    one *reversal* pointing back at that original — `cancel_invoice()` keeps
    the reversal's source_type/source_id identical to the original's (see
    `accounting.services.reverse`), so both are found via the same
    (source_type="Invoice", source_id=invoice.id) filter, distinguished only
    by `reverses`.
    """
    findings: list[Finding] = []
    invoices = list(
        Invoice.objects.exclude(status=InvoiceStatus.DRAFT).values_list("id", "status")
    )
    if not invoices:
        return findings
    invoice_ids = [pk for pk, _ in invoices]

    originals: dict[int, int] = {}
    reversals: dict[int, int] = {}
    for source_id, reverses_id in JournalEntry.objects.filter(
        source_type="Invoice", source_id__in=invoice_ids,
    ).values_list("source_id", "reverses_id"):
        bucket = originals if reverses_id is None else reversals
        bucket[source_id] = bucket.get(source_id, 0) + 1

    for invoice_id, status in invoices:
        n_original = originals.get(invoice_id, 0)
        n_reversal = reversals.get(invoice_id, 0)

        if n_original == 0:
            findings.append(Finding(
                category="invoice_ledger", severity="critical",
                object_type="Invoice", object_id=invoice_id,
                message=f"Invoice {invoice_id} (status={status}) has no original issue posting.",
            ))
        elif n_original > 1:
            findings.append(Finding(
                category="invoice_ledger", severity="critical",
                object_type="Invoice", object_id=invoice_id,
                message=(
                    f"Invoice {invoice_id} has {n_original} original issue postings "
                    "(expected exactly 1)."
                ),
            ))

        if status == InvoiceStatus.CANCELLED:
            if n_original > 0 and n_reversal == 0:
                findings.append(Finding(
                    category="invoice_ledger", severity="critical",
                    object_type="Invoice", object_id=invoice_id,
                    message=f"Invoice {invoice_id} is CANCELLED but has no reversing entry.",
                ))
            elif n_reversal > 1:
                findings.append(Finding(
                    category="invoice_ledger", severity="critical",
                    object_type="Invoice", object_id=invoice_id,
                    message=(
                        f"Invoice {invoice_id} has {n_reversal} reversing entries "
                        "(expected exactly 1)."
                    ),
                ))
        elif n_reversal > 0:
            findings.append(Finding(
                category="invoice_ledger", severity="critical",
                object_type="Invoice", object_id=invoice_id,
                message=(
                    f"Invoice {invoice_id} (status={status}) has a reversing entry "
                    "but is not CANCELLED."
                ),
            ))
    return findings


def _check_payment_ledger() -> list[Finding]:
    """Every Payment must have exactly one ledger posting."""
    findings: list[Finding] = []
    payment_ids = list(Payment.objects.values_list("id", flat=True))
    if not payment_ids:
        return findings

    counts: dict[int, int] = dict(
        JournalEntry.objects.filter(source_type="Payment", source_id__in=payment_ids)
        .values_list("source_id")
        .annotate(n=Count("id"))
    )
    for payment_id in payment_ids:
        n = counts.get(payment_id, 0)
        if n == 0:
            findings.append(Finding(
                category="payment_ledger", severity="critical",
                object_type="Payment", object_id=payment_id,
                message=f"Payment {payment_id} has no ledger posting.",
            ))
        elif n > 1:
            findings.append(Finding(
                category="payment_ledger", severity="critical",
                object_type="Payment", object_id=payment_id,
                message=f"Payment {payment_id} has {n} ledger postings (expected exactly 1).",
            ))
    return findings


def _check_correction_ledger() -> list[Finding]:
    """CreditNote/Refund rows are only ever null on `journal_entry` for the
    instant between their own creation and the same transaction's follow-up
    save (see both models' docstrings) — never legitimately null once
    visible to a separate reader. A hit here is always a real gap."""
    findings: list[Finding] = []
    for model, label in ((CreditNote, "CreditNote"), (Refund, "Refund")):
        for obj_id in model.objects.filter(journal_entry__isnull=True).values_list("id", flat=True):
            findings.append(Finding(
                category="correction_ledger", severity="critical",
                object_type=label, object_id=obj_id,
                message=f"{label} {obj_id} has no linked ledger entry.",
            ))
    return findings


def _check_unbilled_clinical_completions() -> list[Finding]:
    """Every completed `ClinicalProcedure`/`RadiologyOrder`/`LabOrder` must
    have a matching `InvoiceItem` (pre-merge blocker resolution —
    `apps.billing.services.bill_after_clinical_completion` deliberately lets
    the clinical completion succeed even when its billing call fails, so the
    completed-but-unbilled state this check looks for is real and expected
    to occasionally exist, not a schema bug).

    Unlike appointment completion (which legitimately has *no* invoice when
    a free follow-up is consumed — see `FeeValidity`), none of these three
    sources has a "no invoice is expected" case: `bill_ad_hoc_service` always
    bills exactly once per completed item. A missing `InvoiceItem` here is
    therefore always either a still-in-flight retry or a real gap — appointment
    completion is deliberately NOT checked here, since a missing invoice there
    is ambiguous (free visit vs. a real failure) without extra signal this
    system doesn't persist.

    `RadiologyOrder`/`LabOrder` both have a further status *after*
    `COMPLETED` (`REPORTED`/`REVIEWED`) that billing does not re-trigger —
    both are included so an order billed at COMPLETED and then moved on
    doesn't wrongly disappear from this check.
    """
    findings: list[Finding] = []
    sources = (
        (
            ClinicalProcedure, (ProcedureStatus.COMPLETED,),
            BillingSourceType.PROCEDURE, "ClinicalProcedure",
        ),
        (
            RadiologyOrder, (RadiologyOrderStatus.COMPLETED, RadiologyOrderStatus.REPORTED),
            BillingSourceType.RADIOLOGY_ORDER, "RadiologyOrder",
        ),
        (
            LabOrder, (LabOrderStatus.COMPLETED, LabOrderStatus.REVIEWED),
            BillingSourceType.LAB_ORDER, "LabOrder",
        ),
    )
    for model, statuses, source_type, label in sources:
        completed_ids = set(
            model.objects.filter(status__in=statuses).values_list("id", flat=True)
        )
        if not completed_ids:
            continue
        billed_ids = set(
            InvoiceItem.objects.filter(source_type=source_type, source_id__in=completed_ids)
            .values_list("source_id", flat=True)
        )
        for missing_id in completed_ids - billed_ids:
            findings.append(Finding(
                category="unbilled_clinical_completion", severity="critical",
                object_type=label, object_id=missing_id,
                message=(
                    f"{label} {missing_id} is completed but has no InvoiceItem — "
                    "likely a billing posting failure that was caught and logged "
                    "rather than blocking the completion; retry via "
                    "`manage.py retry_unbilled_clinical_items`."
                ),
            ))
    return findings


def _check_write_off_ledger() -> list[Finding]:
    """Every WriteOff must have a valid *original* ledger posting for
    itself; when a WriteOffReversal exists, it must have a valid *reversing*
    entry that actually reverses that original. Both directions of drift are
    checked: a WriteOffReversal row with a missing/wrong ledger reversal, and
    a ledger reversal that exists with no WriteOffReversal row to explain it.

    `accounting_services.reverse()` preserves the original entry's
    `source_type`/`source_id` on the reversal (financial roadmap Task 15,
    same convention `_check_invoice_ledger` already relies on for
    cancellation) — so an original + its reversal legitimately share one
    (source_type, source_id) pair. This check never falls into the "two
    postings = duplicate" trap that pattern would otherwise invite: it always
    resolves each posting through the specific FK that names it
    (`WriteOff.journal_entry`, `WriteOffReversal.journal_entry`), never by
    counting how many JournalEntry rows share a source_id.
    """
    findings: list[Finding] = []
    write_offs = list(
        WriteOff.objects.values(
            "id", "journal_entry_id", "reversal__id", "reversal__journal_entry_id",
        )
    )
    if not write_offs:
        return findings

    original_entry_ids = {wo["journal_entry_id"] for wo in write_offs if wo["journal_entry_id"]}
    reversal_entry_ids = {
        wo["reversal__journal_entry_id"] for wo in write_offs if wo["reversal__journal_entry_id"]
    }
    entries = {
        e["id"]: e
        for e in JournalEntry.objects.filter(
            id__in=original_entry_ids | reversal_entry_ids
        ).values("id", "source_type", "source_id", "reverses_id", "idempotency_key")
    }
    # What does the ledger itself say reverses each original write-off entry?
    reversed_by: dict[int, list[int]] = {}
    for reverses_id, reversing_id in JournalEntry.objects.filter(
        reverses_id__in=original_entry_ids,
    ).values_list("reverses_id", "id"):
        reversed_by.setdefault(reverses_id, []).append(reversing_id)

    for wo in write_offs:
        wo_id = wo["id"]
        entry_id = wo["journal_entry_id"]

        if entry_id is None:
            findings.append(Finding(
                category="write_off_ledger", severity="critical",
                object_type="WriteOff", object_id=wo_id,
                message=f"WriteOff {wo_id} has no linked ledger entry.",
            ))
        else:
            entry = entries.get(entry_id)
            if entry is None:
                findings.append(Finding(
                    category="write_off_ledger", severity="critical",
                    object_type="WriteOff", object_id=wo_id,
                    message=(
                        f"WriteOff {wo_id} references JournalEntry {entry_id}, "
                        "which does not exist."
                    ),
                ))
            else:
                if entry["reverses_id"] is not None:
                    findings.append(Finding(
                        category="write_off_ledger", severity="critical",
                        object_type="WriteOff", object_id=wo_id,
                        message=(
                            f"WriteOff {wo_id}'s journal_entry ({entry_id}) is itself a "
                            "reversal, not an original posting."
                        ),
                    ))
                if entry["source_type"] != "WriteOff" or entry["source_id"] != wo_id:
                    findings.append(Finding(
                        category="write_off_ledger", severity="critical",
                        object_type="WriteOff", object_id=wo_id,
                        message=(
                            f"WriteOff {wo_id}'s journal_entry ({entry_id}) has "
                            f"source_type={entry['source_type']!r} "
                            f"source_id={entry['source_id']} — expected "
                            f"source_type='WriteOff' source_id={wo_id}."
                        ),
                    ))
                expected_key = f"WriteOff:{wo_id}:post"
                if entry["idempotency_key"] != expected_key:
                    findings.append(Finding(
                        category="write_off_ledger", severity="critical",
                        object_type="WriteOff", object_id=wo_id,
                        message=(
                            f"WriteOff {wo_id}'s journal_entry has idempotency_key "
                            f"{entry['idempotency_key']!r} — expected {expected_key!r}."
                        ),
                    ))

        reversal_id = wo["reversal__id"]
        reversal_entry_id = wo["reversal__journal_entry_id"]
        actual_reversers = reversed_by.get(entry_id, []) if entry_id is not None else []

        if reversal_id is not None:
            if reversal_entry_id is None:
                findings.append(Finding(
                    category="write_off_reversal_ledger", severity="critical",
                    object_type="WriteOffReversal", object_id=reversal_id,
                    message=f"WriteOffReversal {reversal_id} has no linked ledger entry.",
                ))
            else:
                reversal_entry = entries.get(reversal_entry_id)
                if reversal_entry is None:
                    findings.append(Finding(
                        category="write_off_reversal_ledger", severity="critical",
                        object_type="WriteOffReversal", object_id=reversal_id,
                        message=(
                            f"WriteOffReversal {reversal_id} references JournalEntry "
                            f"{reversal_entry_id}, which does not exist."
                        ),
                    ))
                else:
                    if reversal_entry["reverses_id"] != entry_id:
                        findings.append(Finding(
                            category="write_off_reversal_ledger", severity="critical",
                            object_type="WriteOffReversal", object_id=reversal_id,
                            message=(
                                f"WriteOffReversal {reversal_id}'s journal_entry "
                                f"({reversal_entry_id}) reverses "
                                f"{reversal_entry['reverses_id']!r}, not the original "
                                f"write-off posting ({entry_id})."
                            ),
                        ))
                    if (
                        reversal_entry["source_type"] != "WriteOff"
                        or reversal_entry["source_id"] != wo_id
                    ):
                        findings.append(Finding(
                            category="write_off_reversal_ledger", severity="critical",
                            object_type="WriteOffReversal", object_id=reversal_id,
                            message=(
                                f"WriteOffReversal {reversal_id}'s journal_entry "
                                f"({reversal_entry_id}) has source_type="
                                f"{reversal_entry['source_type']!r} source_id="
                                f"{reversal_entry['source_id']} — expected "
                                f"source_type='WriteOff' source_id={wo_id}."
                            ),
                        ))
            if (
                entry_id is not None and actual_reversers
                and reversal_entry_id not in actual_reversers
            ):
                findings.append(Finding(
                    category="write_off_reversal_ledger", severity="critical",
                    object_type="WriteOffReversal", object_id=reversal_id,
                    message=(
                        f"WriteOffReversal {reversal_id} points at journal_entry "
                        f"{reversal_entry_id}, but the ledger's actual reversal of "
                        f"WriteOff {wo_id}'s posting is {actual_reversers}."
                    ),
                ))
        elif actual_reversers:
            findings.append(Finding(
                category="write_off_reversal_ledger", severity="critical",
                object_type="WriteOff", object_id=wo_id,
                message=(
                    f"WriteOff {wo_id}'s original posting ({entry_id}) has been "
                    f"reversed at the ledger level (entry {actual_reversers}), but no "
                    "WriteOffReversal record exists."
                ),
            ))
    return findings


def _check_invoice_write_off_aggregate() -> list[Finding]:
    """`Invoice.written_off_amount` must equal `Sum(amount)` over that
    invoice's own non-reversed `WriteOff` rows — derived independently here,
    never by calling `apps.billing.services._recompute_written_off_amount`,
    so this check can actually catch that helper being bypassed, skipped, or
    itself buggy rather than silently agreeing with it."""
    findings: list[Finding] = []
    active_sums = dict(
        WriteOff.objects.filter(reversal__isnull=True)
        .values("invoice_id")
        .annotate(total=Sum("amount"))
        .values_list("invoice_id", "total")
    )
    nonzero_persisted_ids = set(
        Invoice.objects.exclude(written_off_amount=Decimal("0.00")).values_list("id", flat=True)
    )
    candidate_ids = set(active_sums) | nonzero_persisted_ids
    if not candidate_ids:
        return findings

    persisted = dict(
        Invoice.objects.filter(id__in=candidate_ids).values_list("id", "written_off_amount")
    )
    for invoice_id in candidate_ids:
        expected = active_sums.get(invoice_id, Decimal("0.00"))
        actual = persisted.get(invoice_id, Decimal("0.00"))
        if expected != actual:
            findings.append(Finding(
                category="write_off_aggregate", severity="critical",
                object_type="Invoice", object_id=invoice_id,
                message=(
                    f"Invoice {invoice_id}.written_off_amount={actual} does not match "
                    f"the sum of its active (non-reversed) write-offs ({expected})."
                ),
            ))
    return findings


def _check_invoice_balance_non_negative() -> list[Finding]:
    """A negative `Invoice.balance` would mean the clinic owes the patient
    money while the field is presented as a receivable — there is no
    legitimate case for this in the current system (an overpayment routes to
    `PatientDeposit` instead, never a negative balance; see the financial
    roadmap Task 15 hardening of `record_payment`/`issue_credit_note` in
    `apps.billing.services`, which exists specifically to prevent this).
    Read-only defense-in-depth: this never corrects the value, only reports
    it — a hit here means that hardening was bypassed or a new gap opened
    elsewhere.
    """
    findings: list[Finding] = []
    for invoice_id, balance in Invoice.objects.filter(
        balance__lt=Decimal("0.00")
    ).values_list("id", "balance"):
        findings.append(Finding(
            category="invoice_balance", severity="critical",
            object_type="Invoice", object_id=invoice_id,
            message=f"Invoice {invoice_id} has a negative balance ({balance}).",
        ))
    return findings


def _check_idempotency_anomalies() -> list[Finding]:
    """Duplicate JournalEntry.idempotency_key values (a UniqueConstraint
    should make this impossible — a hit means something bypassed the ORM).
    Plus IdempotentRequest rows stuck IN_PROGRESS well past when they should
    have resolved (per the model's own docstring, this should never be
    observed at all outside of a crashed request)."""
    findings: list[Finding] = []

    for row in (
        JournalEntry.objects.values("idempotency_key")
        .annotate(n=Count("id"))
        .filter(n__gt=1)
    ):
        findings.append(Finding(
            category="idempotency", severity="critical",
            object_type="JournalEntry", object_id=row["idempotency_key"],
            message=(
                f"idempotency_key {row['idempotency_key']!r} is used by {row['n']} "
                "journal entries (expected exactly 1)."
            ),
        ))

    stale_cutoff = timezone.now() - STALE_IDEMPOTENT_REQUEST_AGE
    for req_id, operation, created_at in IdempotentRequest.objects.filter(
        status=IdempotencyStatus.IN_PROGRESS, created_at__lt=stale_cutoff,
    ).values_list("id", "operation", "created_at"):
        findings.append(Finding(
            category="idempotency", severity="warning",
            object_type="IdempotentRequest", object_id=req_id,
            message=(
                f"IdempotentRequest {req_id} ({operation}) has been IN_PROGRESS since "
                f"{created_at.isoformat()} — longer than {STALE_IDEMPOTENT_REQUEST_AGE}, "
                "likely a crashed request that never rolled back."
            ),
        ))
    return findings


def _check_invoice_number_integrity() -> list[Finding]:
    """Blank invoice_number on any non-DRAFT invoice (every pre-existing row
    was backfilled by migration 0010 — a blank one now is always a real gap,
    not a historical artifact). Duplicate non-blank numbers. And: the
    sequence must never be behind the highest number actually issued, or the
    next allocation could collide with one already in use. Deliberately does
    NOT scan for numbering gaps — the pre-Task-14 backfill inherited whatever
    gaps already existed in the historical PK sequence, and there is no
    recorded boundary distinguishing an expected historical gap from a real
    one, so a gap scan cannot be made deterministic without false positives
    (see the design discussion for this task).
    """
    findings: list[Finding] = []
    non_draft = Invoice.objects.exclude(status=InvoiceStatus.DRAFT)

    for invoice_id in non_draft.filter(invoice_number="").values_list("id", flat=True):
        findings.append(Finding(
            category="invoice_number", severity="critical",
            object_type="Invoice", object_id=invoice_id,
            message=f"Invoice {invoice_id} has no invoice_number despite not being DRAFT.",
        ))

    for row in (
        Invoice.objects.exclude(invoice_number="")
        .values("invoice_number")
        .annotate(n=Count("id"))
        .filter(n__gt=1)
    ):
        findings.append(Finding(
            category="invoice_number", severity="critical",
            object_type="Invoice", object_id=row["invoice_number"],
            message=(
                f"invoice_number {row['invoice_number']!r} is used by {row['n']} invoices "
                "(expected exactly 1)."
            ),
        ))

    highest_issued = 0
    for value in Invoice.objects.exclude(invoice_number="").values_list("invoice_number", flat=True):
        match = _INVOICE_NUMBER_RE.match(value)
        if match:
            highest_issued = max(highest_issued, int(match.group(1)))

    if highest_issued > 0:
        sequence = InvoiceNumberSequence.objects.filter(scope="default").first()
        if sequence is None:
            findings.append(Finding(
                category="invoice_number", severity="critical",
                object_type="InvoiceNumberSequence", object_id="default",
                message=(
                    "No InvoiceNumberSequence(scope='default') exists, but issued invoices "
                    f"go up to {highest_issued} — the next allocation has no record of what's "
                    "already in use."
                ),
            ))
        elif sequence.last_value < highest_issued:
            findings.append(Finding(
                category="invoice_number", severity="critical",
                object_type="InvoiceNumberSequence", object_id="default",
                message=(
                    f"InvoiceNumberSequence(scope='default').last_value={sequence.last_value} is "
                    f"behind the highest issued invoice number {highest_issued} — the next "
                    "allocation could collide with an already-issued number."
                ),
            ))
    return findings


def _check_cashier_integrity() -> list[Finding]:
    """Two independent, narrowly-scoped signals (see the design discussion
    for why a single unconditional "shift.journal_entry must be set" rule is
    wrong):

    - A non-zero `opening_float` must have its own ledger posting, found via
      the fixed `f"CashierShift:{id}:open"` idempotency key
      (`open_shift`/`_post_opening_float` never save this entry back onto
      the shift row's own `journal_entry` FK — that field is reserved for
      the variance posting only, per `close_shift`'s own docstring).
    - A CLOSED shift with a non-zero variance must have both `approved_by`
      and `journal_entry` set (the variance posting IS reflected on that FK).
      Conversely, a CLOSED shift with no variance should have `journal_entry`
      left None — a stray reference there is a lower-severity data oddity,
      not a missing-money risk.
    """
    findings: list[Finding] = []
    shifts = list(
        CashierShift.objects.values(
            "id", "status", "opening_float", "variance", "approved_by_id", "journal_entry_id",
        )
    )
    if not shifts:
        return findings

    opening_keys = {
        f"CashierShift:{s['id']}:open" for s in shifts if s["opening_float"]
    }
    existing_opening_keys = set(
        JournalEntry.objects.filter(idempotency_key__in=opening_keys)
        .values_list("idempotency_key", flat=True)
    ) if opening_keys else set()

    for s in shifts:
        shift_id = s["id"]
        if s["opening_float"]:
            key = f"CashierShift:{shift_id}:open"
            if key not in existing_opening_keys:
                findings.append(Finding(
                    category="cashier_ledger", severity="critical",
                    object_type="CashierShift", object_id=shift_id,
                    message=(
                        f"CashierShift {shift_id} has a non-zero opening float "
                        f"({s['opening_float']}) but no matching ledger posting ({key})."
                    ),
                ))

        has_variance = s["variance"] is not None and s["variance"] != 0
        if s["status"] == CashierShiftStatus.CLOSED and has_variance:
            if not s["approved_by_id"]:
                findings.append(Finding(
                    category="cashier_ledger", severity="critical",
                    object_type="CashierShift", object_id=shift_id,
                    message=(
                        f"CashierShift {shift_id} has a non-zero variance "
                        f"({s['variance']}) but no approved_by."
                    ),
                ))
            if not s["journal_entry_id"]:
                findings.append(Finding(
                    category="cashier_ledger", severity="critical",
                    object_type="CashierShift", object_id=shift_id,
                    message=(
                        f"CashierShift {shift_id} has a non-zero variance "
                        f"({s['variance']}) but no linked ledger entry."
                    ),
                ))
        elif s["status"] == CashierShiftStatus.CLOSED and not has_variance and s["journal_entry_id"]:
            findings.append(Finding(
                category="cashier_ledger", severity="warning",
                object_type="CashierShift", object_id=shift_id,
                message=(
                    f"CashierShift {shift_id} closed with no variance but still has a "
                    "linked journal_entry — expected None."
                ),
            ))
    return findings


def _check_orphan_ledger_sources() -> list[Finding]:
    """A JournalEntry whose (source_type, source_id) points at a business
    row that no longer exists. Grouped by source_type and bulk-loaded (one
    pair of queries per distinct source_type, never per entry) so this stays
    reasonable as the ledger grows. Only checked for source_types with an
    explicit, known model — an unrecognised/future source_type is skipped,
    never guessed at."""
    findings: list[Finding] = []
    source_types = JournalEntry.objects.values_list("source_type", flat=True).distinct()

    for source_type in source_types:
        model = _ORPHAN_SOURCE_MODELS.get(source_type)
        if model is None:
            continue

        source_ids = set(
            JournalEntry.objects.filter(source_type=source_type)
            .values_list("source_id", flat=True)
        )
        existing_ids = set(
            model.objects.filter(pk__in=source_ids).values_list("pk", flat=True)
        )
        for missing_id in source_ids - existing_ids:
            findings.append(Finding(
                category="orphan_ledger_source", severity="critical",
                object_type=source_type, object_id=missing_id,
                message=(
                    f"JournalEntry references {source_type}:{missing_id}, which no "
                    "longer exists."
                ),
            ))
    return findings


def _check_ar_reconciliation() -> list[Finding]:
    """Reuse the existing `ar_ageing()` reconciliation flags rather than
    re-deriving AR/ledger drift logic that already exists and is tested."""
    findings: list[Finding] = []
    ageing = billing_reports.ar_ageing()

    if not ageing["reconciles"]:
        findings.append(Finding(
            category="report_reconciliation", severity="critical",
            object_type="ar_ageing", object_id="grand_total",
            message=(
                f"ar_ageing() grand totals do not reconcile: total={ageing['grand_total']} "
                f"ledger_grand_total={ageing['ledger_grand_total']}."
            ),
        ))
    for row in ageing["rows"]:
        if not row["reconciles"]:
            findings.append(Finding(
                category="report_reconciliation", severity="critical",
                object_type="Patient", object_id=row["patient_id"],
                message=(
                    f"ar_ageing() row for patient {row['patient_id']} does not reconcile: "
                    f"total={row['total']} ledger_balance={row['ledger_balance']}."
                ),
            ))
    return findings
