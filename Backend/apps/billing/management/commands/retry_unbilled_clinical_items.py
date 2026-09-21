"""Pre-merge blocker resolution — retries billing for completed clinical
items that `apps.billing.services.bill_after_clinical_completion` caught a
failure for (see that function's docstring). Detection lives in Task 16's
`apps.accounting.integrity._check_unbilled_clinical_completions`; this
command is the explicit, human-triggered retry half — deliberately not run
automatically by the integrity job itself (Task 16 stays detect-only).

Safe to run at any time, repeatedly: it re-calls the exact same
`handle_*_completed` functions the original completion did, which are
already idempotent via `bill_ad_hoc_service`'s existing check-then-act +
`InvoiceItem` `UniqueConstraint` — an item that's already billed (by an
earlier retry, or a race with another retry run) is simply skipped, never
double-billed.

Read + write (unlike Task 16's checks): this command *does* call the
billing/posting layer. It is not part of the detect-only Task 16 job.
"""
import logging

from django.core.management.base import BaseCommand

from apps.billing.models import InvoiceItem
from apps.billing.services import (
    handle_lab_order_completed,
    handle_procedure_completed,
    handle_radiology_order_completed,
)
from apps.core.enums import (
    BillingSourceType,
    LabOrderStatus,
    ProcedureStatus,
    RadiologyOrderStatus,
)
from apps.medical_records.models import LabOrder
from apps.procedures.models import ClinicalProcedure
from apps.radiology.models import RadiologyOrder

logger = logging.getLogger(__name__)

# (model, statuses considered "should already be billed", BillingSourceType,
# label, the completion hook to retry, and how to resolve the `user` kwarg
# it needs) — same status sets as the Task 16 detection check, so this
# command retries exactly what that check flags.
_SOURCES = (
    (
        ClinicalProcedure, (ProcedureStatus.COMPLETED,), BillingSourceType.PROCEDURE,
        "ClinicalProcedure", handle_procedure_completed,
        lambda procedure: procedure.doctor.user,
    ),
    (
        RadiologyOrder,
        (RadiologyOrderStatus.COMPLETED, RadiologyOrderStatus.REPORTED),
        BillingSourceType.RADIOLOGY_ORDER, "RadiologyOrder", handle_radiology_order_completed,
        lambda order: order.doctor.user,
    ),
    (
        LabOrder, (LabOrderStatus.COMPLETED, LabOrderStatus.REVIEWED),
        BillingSourceType.LAB_ORDER, "LabOrder", handle_lab_order_completed,
        lambda order: order.doctor.user,
    ),
)


class Command(BaseCommand):
    help = (
        "Retries billing for completed procedures/radiology orders/lab orders "
        "that have no InvoiceItem yet (see Task 16's unbilled_clinical_completions "
        "check). Idempotent and safe to re-run — already-billed items are skipped."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run", action="store_true",
            help="List what would be retried without actually posting anything.",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        total_found = 0
        total_succeeded = 0
        total_failed = 0

        for model, statuses, source_type, label, hook, resolve_user in _SOURCES:
            completed_ids = set(
                model.objects.filter(status__in=statuses).values_list("id", flat=True)
            )
            if not completed_ids:
                continue
            billed_ids = set(
                InvoiceItem.objects.filter(source_type=source_type, source_id__in=completed_ids)
                .values_list("source_id", flat=True)
            )
            missing_ids = completed_ids - billed_ids
            if not missing_ids:
                continue

            for obj in model.objects.filter(id__in=missing_ids):
                total_found += 1
                if dry_run:
                    self.stdout.write(f"Would retry: {label} {obj.id}")
                    continue
                try:
                    hook(obj, user=resolve_user(obj))
                except Exception:
                    total_failed += 1
                    logger.exception(
                        "retry_unbilled_clinical_items: still failing for %s %s",
                        label, obj.id,
                    )
                    self.stderr.write(self.style.ERROR(f"FAILED: {label} {obj.id} — see logs"))
                else:
                    total_succeeded += 1
                    self.stdout.write(self.style.SUCCESS(f"Billed: {label} {obj.id}"))

        if total_found == 0:
            self.stdout.write(self.style.SUCCESS("No unbilled completed clinical items found."))
        elif dry_run:
            self.stdout.write(f"{total_found} item(s) would be retried.")
        else:
            self.stdout.write(
                f"Retried {total_found} item(s): {total_succeeded} succeeded, "
                f"{total_failed} still failed."
            )
