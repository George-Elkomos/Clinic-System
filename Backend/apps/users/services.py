"""Patient-facing computed metrics that aren't worth persisting/denormalizing."""
from django.conf import settings


def patient_reliability(patient_profile):
    """Running no-show reliability score (0-100%) + tier label.

    Starts at 100 and loses settings.RELIABILITY_NO_SHOW_PENALTY points per
    NO_SHOW appointment (floored at 0). CANCELLED/EXPIRED never affect it —
    only an actual no-show does, per the product spec: a patient who simply
    never confirmed a booking (EXPIRED) hasn't shown any unreliable behavior.
    """
    from apps.appointments.models import Appointment
    from apps.core.enums import AppointmentStatus

    no_shows = Appointment.objects.filter(
        patient=patient_profile, status=AppointmentStatus.NO_SHOW,
    ).count()
    score = max(0, 100 - no_shows * settings.RELIABILITY_NO_SHOW_PENALTY)
    if score >= 80:
        label = "GOOD"
    elif score >= 50:
        label = "WATCH"
    else:
        label = "HIGH_RISK"
    return {"score": score, "label": label}
