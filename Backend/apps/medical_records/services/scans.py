"""Notify the patient's nearest-in-time doctor when the patient uploads a scan
themselves (not ordered/uploaded by clinical staff).

`treating_doctors` is cumulative and never shrinks (see DoctorPatient), so
notifying every doctor a patient has ever seen would get noisier over a
patient's lifetime. Instead this picks one doctor: whoever the patient's next
upcoming appointment is with, falling back to whoever their most recently
completed appointment was with. If neither exists, nobody is notified.
"""
from apps.core.enums import AppointmentStatus, NotificationVerb
from apps.notifications.services import notify

UPCOMING_STATUSES = (
    AppointmentStatus.PENDING,
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.CHECKED_IN,
    AppointmentStatus.IN_PROGRESS,
)


def _nearest_doctor_for_patient(patient):
    from apps.appointments.models import Appointment

    upcoming = (
        Appointment.objects.filter(patient=patient, status__in=UPCOMING_STATUSES)
        .select_related("doctor__user")
        .order_by("scheduled_start")
        .first()
    )
    if upcoming:
        return upcoming.doctor

    recent = (
        Appointment.objects.filter(patient=patient, status=AppointmentStatus.COMPLETED)
        .select_related("doctor__user")
        .order_by("-completed_at")
        .first()
    )
    return recent.doctor if recent else None


def notify_nearest_doctor_of_scan_upload(scan) -> None:
    doctor = _nearest_doctor_for_patient(scan.patient)
    if doctor is None:
        return
    notify(
        recipient=doctor.user,
        verb=NotificationVerb.PATIENT_SCAN_UPLOADED,
        title="Patient uploaded a scan",
        title_ar="قام المريض برفع أشعة",
        body=f"{scan.patient.user.get_full_name()} uploaded a new {scan.get_category_display()} scan.",
        body_ar=f"قام {scan.patient.user.get_full_name()} برفع أشعة {scan.get_category_display()} جديدة.",
        related=scan,
    )
