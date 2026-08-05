"""Calendar-aligned period-start helper for Phase 16 analytics endpoints only
(specialty-analytics, lab-analytics, and diagnosis-distribution's "year"
option). This mirrors the calendar-aligned style already used by
apps.billing.services._period_start (start of week/month/year) but is a
deliberately separate helper — it does not refactor that function or
apps.reports.services._period_start (rolling week=-7d/month=-30d lookback).
Both older implementations keep their existing behavior unchanged.
"""
from datetime import date, timedelta

from django.utils import timezone

from .enums import PeriodChoices


def period_start(period: str) -> date:
    """Inclusive calendar-aligned start date for `period`.

    - WEEK:  most recent Monday (ISO week start)
    - MONTH: first day of the current calendar month
    - YEAR:  January 1 of the current year
    Unrecognized values fall back to MONTH.
    """
    today = timezone.localdate()
    if period == PeriodChoices.WEEK:
        return today - timedelta(days=today.weekday())
    if period == PeriodChoices.YEAR:
        return today.replace(month=1, day=1)
    return today.replace(day=1)
