"""Patient-facing computed metrics that aren't worth persisting/denormalizing."""
from django.conf import settings


def patient_reliability(patient_profile):
    """Running no-show reliability score (0-100%) + tier label.

    Starts at 100 and loses settings.RELIABILITY_NO_SHOW_PENALTY points per
    appointment that auto-expired unconfirmed (EXPIRED) or was confirmed and
    never attended (NO_SHOW), floored at 0. CANCELLED never affects it — a
    patient (or the desk) actively cancelling isn't unreliable behavior;
    only the two "silently didn't follow through" outcomes are.
    """
    from apps.appointments.models import Appointment
    from apps.core.enums import AppointmentStatus

    lapses = Appointment.objects.filter(
        patient=patient_profile,
        status__in=(AppointmentStatus.NO_SHOW, AppointmentStatus.EXPIRED),
    ).count()
    score = max(0, 100 - lapses * settings.RELIABILITY_NO_SHOW_PENALTY)
    if score >= 80:
        label = "GOOD"
    elif score >= 50:
        label = "WATCH"
    else:
        label = "HIGH_RISK"
    return {"score": score, "label": label}
