"""Pre-merge blocker resolution — accounting bootstrap (part 2 of 2, alongside
`seed_chart_of_accounts`).

Ensures a `FiscalYear` and a monthly `Period` exist covering a given date
(default: today) — required before the *first* production ledger posting,
since `accounting.services.post()` raises `NoPeriodForDateError` when none
covers the posting date.

Deliberately never invents a fiscal year's boundaries: if no existing
`FiscalYear` already covers the target date, `--fiscal-year-start`/
`--fiscal-year-end` are required — that is a business decision (when does
this clinic's fiscal year start?), not something this command will guess.
Once a fiscal year has been established once, every later month only needs
`manage.py bootstrap_period` (no arguments) to roll a new Period forward —
safe to run on every deploy from that point on.

Idempotent and non-destructive:
- If a Period already covers the target date, this is a no-op (prints and
  exits 0) — never edits or re-creates it.
- If a FiscalYear by the given name already exists with *different* dates
  than what was passed, this refuses (raises `CommandError`) rather than
  silently accepting the mismatch or altering the existing row.
- Relies on `Period.save()`'s own `OverlappingPeriodError` as a final
  backstop against creating a Period that conflicts with one that already
  exists under a different name/fiscal year.
"""
import calendar
from datetime import date

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.accounting.exceptions import OverlappingPeriodError
from apps.accounting.models import FiscalYear, Period
from apps.core.enums import FiscalYearStatus, PeriodStatus


class Command(BaseCommand):
    help = (
        "Idempotently ensure a FiscalYear and a monthly Period exist covering "
        "--for-date (default: today). Required once before the first production "
        "ledger posting. Never invents fiscal-year boundaries — pass "
        "--fiscal-year-start/--fiscal-year-end the first time; later months only "
        "need this command with no arguments."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--for-date", default=None,
            help="Date (YYYY-MM-DD) the Period must cover. Defaults to today.",
        )
        parser.add_argument(
            "--fiscal-year-start", default=None,
            help="FiscalYear start date (YYYY-MM-DD). Required only if no existing "
                 "FiscalYear already covers --for-date.",
        )
        parser.add_argument(
            "--fiscal-year-end", default=None,
            help="FiscalYear end date (YYYY-MM-DD). Required only if no existing "
                 "FiscalYear already covers --for-date.",
        )
        parser.add_argument(
            "--fiscal-year-name", default=None,
            help="Optional FiscalYear.name. Defaults to the start year, e.g. '2026'.",
        )

    def handle(self, *args, **options):
        for_date = (
            date.fromisoformat(options["for_date"]) if options["for_date"]
            else timezone.localdate()
        )

        existing_period = Period.for_date(for_date)
        if existing_period is not None:
            self.stdout.write(self.style.SUCCESS(
                f"Period already covers {for_date}: {existing_period} "
                f"(status={existing_period.status}) — nothing to do."
            ))
            return

        fiscal_year = FiscalYear.objects.filter(
            start_date__lte=for_date, end_date__gte=for_date,
        ).first()

        if fiscal_year is None:
            start_raw, end_raw = options["fiscal_year_start"], options["fiscal_year_end"]
            if not (start_raw and end_raw):
                raise CommandError(
                    f"No FiscalYear covers {for_date}, and none was given. This is a "
                    "business decision this command will not guess at — re-run with "
                    "--fiscal-year-start YYYY-MM-DD --fiscal-year-end YYYY-MM-DD."
                )
            start, end = date.fromisoformat(start_raw), date.fromisoformat(end_raw)
            if not (start <= for_date <= end):
                raise CommandError(
                    f"--fiscal-year-start/--fiscal-year-end ({start}..{end}) does not "
                    f"cover --for-date ({for_date})."
                )

            name = options["fiscal_year_name"] or str(start.year)
            fiscal_year, created = FiscalYear.objects.get_or_create(
                name=name,
                defaults={"start_date": start, "end_date": end, "status": FiscalYearStatus.OPEN},
            )
            if not created and (fiscal_year.start_date != start or fiscal_year.end_date != end):
                raise CommandError(
                    f"A FiscalYear named {name!r} already exists with different dates "
                    f"({fiscal_year.start_date}..{fiscal_year.end_date}) than requested "
                    f"({start}..{end}) — refusing to alter it. Pick a different "
                    "--fiscal-year-name, or resolve the mismatch manually."
                )
            self.stdout.write(self.style.SUCCESS(
                f"{'Created' if created else 'Reusing'} FiscalYear {fiscal_year} "
                f"({fiscal_year.start_date}..{fiscal_year.end_date})."
            ))

        last_day = calendar.monthrange(for_date.year, for_date.month)[1]
        month_start = date(for_date.year, for_date.month, 1)
        month_end = date(for_date.year, for_date.month, last_day)

        try:
            period, created = Period.objects.get_or_create(
                fiscal_year=fiscal_year, start_date=month_start, end_date=month_end,
                defaults={"name": for_date.strftime("%Y-%m"), "status": PeriodStatus.OPEN},
            )
        except OverlappingPeriodError as exc:
            raise CommandError(
                f"Cannot create a Period for {month_start}..{month_end}: {exc} — an "
                "existing Period under a different fiscal year already overlaps this "
                "range. Resolve the conflict manually; nothing was changed."
            ) from exc

        self.stdout.write(self.style.SUCCESS(
            f"{'Created' if created else 'Reusing'} Period {period} "
            f"({period.start_date}..{period.end_date}) covering {for_date}."
        ))
