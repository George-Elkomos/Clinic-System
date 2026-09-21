"""Pre-merge blocker resolution — read-only production readiness check.

Verifies, without changing anything, that the ledger is actually postable
right now:
- every `AccountMap` purpose/qualifier the billing posting layer actually
  resolves against (derived from the real call sites, not just whatever
  happens to be seeded) resolves to a postable `Account`;
- an OPEN `Period` covers today.

Exits non-zero (via `CommandError`) and prints exactly what's missing if
either check fails — meant to run once after `migrate` + `seed_chart_of_
accounts` + `bootstrap_period`, and before billing traffic is allowed, so a
deploy can *prove* the ledger is ready rather than discover
`UnmappedPurposeError`/`NoPeriodForDateError` on the first real invoice.
"""
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.accounting.models import AccountMap, Period
from apps.billing.services import _CASH_PURPOSE_BY_PAYMENT_METHOD
from apps.core.enums import PeriodStatus, ServiceItemType

# The exact (purpose, qualifier) pairs apps.billing.services actually resolves
# against today — kept here as a single source of truth derived from the real
# call sites (grepped directly), not copied from seed_chart_of_accounts'
# MAP_ENTRIES, which may legitimately seed forward-looking purposes
# (PATIENT_DEPOSIT_LIABILITY, REFUND_CONTRA) no current code path uses yet.
# ServiceItemType/_CASH_PURPOSE_BY_PAYMENT_METHOD are read live so this list
# can never silently go stale if either grows a new value later.
_STATIC_REQUIRED_PURPOSES = [
    ("AR_PATIENT", ""),
    ("DISCOUNT", ""),
    ("PATIENT_CREDIT_BALANCE", ""),
    ("BAD_DEBT_PATIENT", ""),
    ("CASH_VARIANCE", ""),
]


def _required_purposes():
    purposes = list(_STATIC_REQUIRED_PURPOSES)
    purposes += [
        ("REVENUE_BY_SERVICE_CATEGORY", category) for category in ServiceItemType.values
    ]
    purposes += list(_CASH_PURPOSE_BY_PAYMENT_METHOD.values())
    # Stable order, de-duplicated (dict preserves insertion order in py3.7+).
    return list(dict.fromkeys(purposes))


class Command(BaseCommand):
    help = (
        "Read-only: verifies every AccountMap purpose the billing posting layer "
        "resolves against exists and is postable, and that an OPEN Period covers "
        "today. Exits non-zero with a clear list of what's missing if not — never "
        "modifies anything."
    )

    def handle(self, *args, **options):
        errors = []

        for purpose, qualifier in _required_purposes():
            label = f"{purpose}:{qualifier}" if qualifier else purpose
            try:
                account = AccountMap.resolve(purpose, qualifier)
                account.assert_postable()
            except Exception as exc:
                errors.append(f"  - {label} -> {exc}")

        today = timezone.localdate()
        period = Period.for_date(today)
        if period is None:
            errors.append(f"  - No Period covers {today}.")
        elif period.status != PeriodStatus.OPEN:
            errors.append(
                f"  - Period covering {today} ({period}) is {period.status}, not OPEN."
            )

        if errors:
            raise CommandError(
                "Finance preflight FAILED — do not enable billing traffic:\n"
                + "\n".join(errors)
            )

        self.stdout.write(self.style.SUCCESS(
            f"Finance preflight OK — {len(_required_purposes())} account-map "
            f"purposes resolve, and an OPEN Period covers {today}."
        ))
