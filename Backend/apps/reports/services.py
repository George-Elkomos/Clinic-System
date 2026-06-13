"""Manager analytics computed from existing app data (no models of its own)."""
from datetime import timedelta

from django.db.models import Avg
from django.utils import timezone

from apps.appointments.models import Appointment
from apps.core.enums import AppointmentStatus, RoleChoices
from apps.doctors.models import DoctorAbsence, DoctorProfile
from apps.reviews.models import Review
from apps.users.models import User


def _period_start(period):
    today = timezone.localdate()
    if period == "week":
        return today - timedelta(days=7)
    if period == "month":
        return today - timedelta(days=30)
    return None  # all-time


def build_report(period="month"):
    start = _period_start(period)
    appts = Appointment.objects.all()
    if start:
        appts = appts.filter(scheduled_start__date__gte=start)

    doctors = list(DoctorProfile.objects.select_related("user"))

    per_doctor = []
    for d in doctors:
        da = appts.filter(doctor=d)
        total = da.count()
        no_show = da.filter(status=AppointmentStatus.NO_SHOW).count()
        per_doctor.append({
            "doctor_id": d.id,
            "doctor_name": str(d),
            "total": total,
            "completed": da.filter(status=AppointmentStatus.COMPLETED).count(),
            "no_show": no_show,
            "cancelled": da.filter(status=AppointmentStatus.CANCELLED).count(),
            "no_show_rate": round(no_show / total * 100, 1) if total else 0.0,
        })

    # Average wait (check-in -> start), computed in Python to stay DB-agnostic.
    waited = appts.filter(
        status=AppointmentStatus.COMPLETED,
        checked_in_at__isnull=False,
        started_at__isnull=False,
    )
    waits = [(a.started_at - a.checked_in_at).total_seconds() / 60 for a in waited]
    avg_wait_minutes = round(sum(waits) / len(waits), 1) if waits else 0.0

    reviews = Review.objects.filter(is_hidden=False)
    if start:
        reviews = reviews.filter(created_at__date__gte=start)
    ratings = []
    for d in doctors:
        rd = reviews.filter(doctor=d)
        ratings.append({
            "doctor_name": str(d),
            "count": rd.count(),
            "average": round(rd.aggregate(a=Avg("rating"))["a"] or 0, 2),
        })
    most_reviewed = max(ratings, key=lambda r: r["count"], default=None)
    if most_reviewed and most_reviewed["count"] == 0:
        most_reviewed = None

    patients = User.objects.filter(role=RoleChoices.PATIENT)
    if start:
        patients = patients.filter(date_joined__date__gte=start)
    new_patients_total = patients.count()

    attendance = []
    for d in doctors:
        abss = DoctorAbsence.objects.filter(doctor=d)
        if start:
            abss = abss.filter(end_date__gte=start)
        days = sum((a.end_date - a.start_date).days + 1 for a in abss)
        attendance.append({"doctor_name": str(d), "absence_days": days})

    return {
        "period": period,
        "generated_at": timezone.now().isoformat(),
        "overall": {
            "total": appts.count(),
            "completed": appts.filter(status=AppointmentStatus.COMPLETED).count(),
            "no_show": appts.filter(status=AppointmentStatus.NO_SHOW).count(),
            "cancelled": appts.filter(status=AppointmentStatus.CANCELLED).count(),
        },
        "avg_wait_minutes": avg_wait_minutes,
        "appointments_per_doctor": per_doctor,
        "ratings": ratings,
        "most_reviewed": most_reviewed,
        "new_patients_total": new_patients_total,
        "attendance": attendance,
    }
