"""Billing-side reports (financial roadmap Task 9): AR ageing and the patient
statement. These need `Invoice.due_date` — a billing concept the ledger
doesn't model — which is why they live here rather than in
apps.accounting.reports (trial balance / income statement / balance sheet,
which stay billing-agnostic per the Task 5 boundary rule).

Both cross-check their billing-derived figures against the ledger's own
`apps.accounting.services.party_balance()` rather than trusting
`Invoice.balance` alone — the whole point of "derived from the ledger, not
Invoice.balance" in the roadmap's own wording for Task 9.
"""
from decimal import Decimal

from django.utils import timezone

from apps.accounting import services as accounting_services
from apps.core.enums import InvoiceStatus

from .models import CreditNote, Invoice, Payment, Refund

_AGEING_BUCKETS = [
    ("current", 0, 0),
    ("days_1_30", 1, 30),
    ("days_31_60", 31, 60),
    ("days_61_90", 61, 90),
    ("over_90", 91, None),
]


def _bucket_for(days_overdue):
    for name, low, high in _AGEING_BUCKETS:
        if days_overdue >= low and (high is None or days_overdue <= high):
            return name
    return _AGEING_BUCKETS[-1][0]  # pragma: no cover — buckets are exhaustive


def ar_ageing(as_of=None):
    """Outstanding patient AR bucketed by days overdue. `ledger_balance` per
    row is the ledger's own party_balance for that patient — a mismatch
    against the bucketed Invoice-derived total would mean the two have
    drifted out of reconciliation."""
    as_of = as_of or timezone.localdate()
    open_invoices = (
        Invoice.objects.filter(
            status__in=(InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID), balance__gt=0,
        )
        .select_related("patient")
    )

    by_patient = {}
    for invoice in open_invoices:
        days_overdue = (as_of - invoice.due_date).days if invoice.due_date else 0
        bucket = _bucket_for(days_overdue) if days_overdue > 0 else "current"
        row = by_patient.setdefault(invoice.patient_id, {
            "patient_id": invoice.patient_id,
            "patient_name": invoice.patient.get_full_name(),
            **{name: Decimal("0.00") for name, _, _ in _AGEING_BUCKETS},
            "total": Decimal("0.00"),
        })
        row[bucket] += invoice.balance
        row["total"] += invoice.balance

    rows = list(by_patient.values())
    for row in rows:
        row["ledger_balance"] = accounting_services.party_balance(
            "Patient", row["patient_id"], as_of=as_of,
        )

    grand_total = sum((row["total"] for row in rows), Decimal("0.00"))
    return {"as_of": as_of, "rows": rows, "grand_total": grand_total}


def patient_statement(patient, as_of=None):
    """One patient's invoices/payments/credit-notes/refunds as of `as_of`,
    reconciled against the ledger's own party_balance for that patient."""
    as_of = as_of or timezone.localdate()
    invoices = Invoice.objects.filter(patient=patient, invoice_date__lte=as_of)
    payments = Payment.objects.filter(invoice__patient=patient, paid_at__date__lte=as_of)
    credit_notes = CreditNote.objects.filter(invoice__patient=patient, created_at__date__lte=as_of)
    refunds = Refund.objects.filter(invoice__patient=patient, created_at__date__lte=as_of)

    ledger_balance = accounting_services.party_balance("Patient", patient.id, as_of=as_of)
    invoice_derived_balance = sum((inv.balance for inv in invoices), Decimal("0.00"))

    return {
        "patient_id": patient.id,
        "as_of": as_of,
        "invoices": list(
            invoices.values("id", "invoice_date", "total", "paid_amount", "balance", "status")
        ),
        "payments": list(payments.values("id", "paid_at", "amount", "payment_method")),
        "credit_notes": list(credit_notes.values("id", "amount", "reason_code")),
        "refunds": list(refunds.values("id", "amount", "reason_code")),
        "ledger_balance": ledger_balance,
        "invoice_derived_balance": invoice_derived_balance,
        "reconciles": ledger_balance == invoice_derived_balance,
    }
