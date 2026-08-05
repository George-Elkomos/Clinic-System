"""Phase 16 — advanced manager analytics (specialty performance, lab
analytics). Kept separate from services.py to keep the Phase 4 report
aggregations uncluttered. Uses apps.core.periods.period_start (calendar-
aligned), NOT apps.reports.services._period_start (rolling lookback)."""
from collections import defaultdict
from datetime import date

from django.db.models import Count, Q
from django.db.models.functions import TruncMonth
from django.utils import timezone

from apps.appointments.models import Appointment
from apps.core.enums import AppointmentStatus
from apps.core.periods import period_start

TREND_MONTHS = 6  # fixed lookback for the "monthly growth trend" line chart


def _trend_window_start(months: int = TREND_MONTHS) -> date:
    """First day of the month `months - 1` months before the current month,
    e.g. months=6 in August 2026 -> 2026-03-01."""
    today = timezone.localdate()
    y, m = today.year, today.month
    for _ in range(months - 1):
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    return date(y, m, 1)


def specialty_analytics(period="month"):
    """Per-specialty appointment totals, completion rate, avg wait time, plus
    a fixed 6-month monthly_trend for the growth line chart.

    Multi-specialty doctors fan out: an appointment counts toward EVERY
    specialty of its doctor (Phase 16 decision — no "primary specialty"
    field). A doctor with 0 specialties contributes to no specialty bucket.
    """
    start = period_start(period)

    appts = Appointment.objects.filter(
        doctor__specialties__isnull=False, scheduled_start__date__gte=start
    )

    totals = (
        appts.values(
            "doctor__specialties__id",
            "doctor__specialties__name",
            "doctor__specialties__name_ar",
        )
        .annotate(
            total=Count("id"),
            completed=Count("id", filter=Q(status=AppointmentStatus.COMPLETED)),
        )
        .order_by("-total")
    )

    # Avg wait time per specialty — Python-computed, DB-agnostic, mirrors
    # build_report()'s wait-time block (apps/reports/services.py).
    waited = (
        appts.filter(
            status=AppointmentStatus.COMPLETED,
            checked_in_at__isnull=False,
            started_at__isnull=False,
        )
        .prefetch_related("doctor__specialties")
        .distinct()
    )
    wait_minutes_by_specialty = defaultdict(list)
    for a in waited:
        minutes = (a.started_at - a.checked_in_at).total_seconds() / 60
        for sp in a.doctor.specialties.all():
            wait_minutes_by_specialty[sp.id].append(minutes)

    specialties_out = []
    for row in totals:
        sp_id = row["doctor__specialties__id"]
        total = row["total"]
        completed = row["completed"]
        waits = wait_minutes_by_specialty.get(sp_id, [])
        specialties_out.append({
            "specialty_id": sp_id,
            "specialty_name": row["doctor__specialties__name"],
            "specialty_name_ar": row["doctor__specialties__name_ar"],
            "total_appointments": total,
            "completed": completed,
            "completion_rate": round(completed / total * 100, 1) if total else 0.0,
            "avg_wait_minutes": round(sum(waits) / len(waits), 1) if waits else 0.0,
        })

    # Monthly growth trend — fixed 6-month lookback, independent of `period`.
    trend_start = _trend_window_start()
    trend_rows = (
        Appointment.objects.filter(
            doctor__specialties__isnull=False,
            scheduled_start__date__gte=trend_start,
        )
        .annotate(month=TruncMonth("scheduled_start"))
        .values(
            "month",
            "doctor__specialties__id",
            "doctor__specialties__name",
            "doctor__specialties__name_ar",
        )
        .annotate(count=Count("id"))
        .order_by("month", "doctor__specialties__id")
    )
    monthly_trend = [
        {
            "month": row["month"].strftime("%Y-%m"),
            "specialty_id": row["doctor__specialties__id"],
            "specialty_name": row["doctor__specialties__name"],
            "specialty_name_ar": row["doctor__specialties__name_ar"],
            "count": row["count"],
        }
        for row in trend_rows
    ]

    return {
        "period": period,
        "generated_at": timezone.now().isoformat(),
        "specialties": specialties_out,
        "monthly_trend": monthly_trend,
    }


def lab_analytics(period="month"):
    """Per-test-name lab order volume, avg turnaround (Python-computed, DB-
    agnostic, mirrors build_report()'s wait-time pattern), and % of results
    that are abnormal.

    "In period" is defined via the parent LabOrder.ordered_at (not
    LabOrderResult.result_date), for consistency with the order-level
    period filter (Phase 16 decision).
    """
    from apps.medical_records.models import LabOrder, LabOrderItem, LabOrderResult

    start = period_start(period)

    orders = LabOrder.objects.filter(ordered_at__date__gte=start)
    order_ids = list(orders.values_list("id", flat=True))

    # Test-name bucketing key: LabOrderItem.test_name and LabOrderResult.test_name
    # are two independent free-text fields (LabOrderResult.order_item is a
    # nullable FK, not always set — see complete_order()/manual result entry),
    # so the same real-world test can be typed with different casing/spacing
    # on the item vs. its own result (e.g. item "CBC", result "cbc "). Grouping
    # each side by its raw string independently would silently split one
    # test's volume/turnaround data from its abnormal-rate data into two
    # different rows — the same contradictory "turnaround=None next to
    # abnormal_pct>0" symptom as the earlier REVIEWED-status bug, just from a
    # different cause. Normalize (casefold + strip) as the join key on BOTH
    # sides so a case/whitespace difference can't fragment one test into two.
    def _key(name: str) -> str:
        return name.strip().casefold()

    # Volume per test name (LabOrderItem — no schema change, free-text grouping).
    # Aggregated in Python (not .values().annotate()) so the normalized key,
    # not the raw string, is what SQL would otherwise GROUP BY.
    by_test = {}  # key -> {"display_name": str, "count": int}
    for item in LabOrderItem.objects.filter(order_id__in=order_ids).only("test_name"):
        key = _key(item.test_name)
        bucket = by_test.setdefault(key, {"display_name": item.test_name, "count": 0})
        bucket["count"] += 1

    # Turnaround = completed_at - ordered_at, computed in Python (DB-agnostic,
    # exactly like build_report()'s avg_wait_minutes calc). Per-test buckets
    # legitimately reuse the same order-level hours for every item on that
    # order ("how long did results for test X take, given the orders it
    # appeared on"). The overall figure below is computed once per order
    # (not per item) to avoid double-counting orders with 2+ items.
    #
    # Deliberately NOT filtered on status=COMPLETED: LabOrderStatus has a
    # REVIEWED stage *after* COMPLETED (apps/medical_records/services/
    # lab_orders.py:review_order — only flips `status`/`reviewed_at`,
    # `completed_at` is left untouched), so a completed_at__isnull=False
    # check alone is what actually means "this order has turnaround data",
    # regardless of whether it has since been reviewed. Filtering on the
    # exact COMPLETED status would silently drop every reviewed order from
    # the turnaround average while its results still count toward
    # abnormal_pct below — reviewed and completed orders must agree here.
    completed_orders = orders.filter(
        ordered_at__isnull=False,
        completed_at__isnull=False,
    ).prefetch_related("items")
    turnaround_hours_by_test = defaultdict(list)
    order_level_hours = []
    for order in completed_orders:
        hours = (order.completed_at - order.ordered_at).total_seconds() / 3600
        order_level_hours.append(hours)
        for item in order.items.all():
            turnaround_hours_by_test[_key(item.test_name)].append(hours)

    overall_avg_turnaround_hours = (
        round(sum(order_level_hours) / len(order_level_hours), 1) if order_level_hours else None
    )

    # Abnormal % — overall, and per test name, keyed the same normalized way
    # as `by_test` above so a result typed under a different case than its
    # item (or entered with no order_item link at all) still lands in the
    # same bucket as that test's volume/turnaround figures.
    results = list(LabOrderResult.objects.filter(order_id__in=order_ids).only("test_name", "is_abnormal"))
    total_results = len(results)
    abnormal_results = sum(1 for r in results if r.is_abnormal)
    abnormal_by_test = defaultdict(lambda: {"total": 0, "abnormal": 0})
    for r in results:
        bucket = abnormal_by_test[_key(r.test_name)]
        bucket["total"] += 1
        if r.is_abnormal:
            bucket["abnormal"] += 1

    tests_out = []
    for key, info in sorted(by_test.items(), key=lambda kv: -kv[1]["count"]):
        hours = turnaround_hours_by_test.get(key, [])
        result_row = abnormal_by_test.get(key)
        tests_out.append({
            "test_name": info["display_name"],
            "count": info["count"],  # LabOrderItem rows with this test_name in period
            "avg_turnaround_hours": round(sum(hours) / len(hours), 1) if hours else None,
            "results_count": result_row["total"] if result_row else 0,
            "abnormal_count": result_row["abnormal"] if result_row else 0,
            "abnormal_pct": (
                round(result_row["abnormal"] / result_row["total"] * 100, 1)
                if result_row and result_row["total"] else 0.0
            ),
        })

    return {
        "period": period,
        "generated_at": timezone.now().isoformat(),
        "total_lab_orders": orders.count(),
        "overall_avg_turnaround_hours": overall_avg_turnaround_hours,
        "tests": tests_out,
        "total_results": total_results,
        "abnormal_results": abnormal_results,
        "abnormal_result_pct": (
            round(abnormal_results / total_results * 100, 1) if total_results else 0.0
        ),
    }
