"""Central enums (Django TextChoices/IntegerChoices).

Stable machine keys live here; the frontend maps these keys to EN/AR labels via
i18n, so labels are never hardcoded in either layer.
"""
from django.db import models
from django.utils.translation import gettext_lazy as _


class RoleChoices(models.TextChoices):
    PATIENT = "PATIENT", _("Patient")
    DOCTOR = "DOCTOR", _("Doctor")
    SECRETARY = "SECRETARY", _("Secretary")
    MANAGER = "MANAGER", _("Manager")


class LanguageChoices(models.TextChoices):
    EN = "en", _("English")
    AR = "ar", _("Arabic")


class GenderChoices(models.TextChoices):
    MALE = "MALE", _("Male")
    FEMALE = "FEMALE", _("Female")
    OTHER = "OTHER", _("Other")
    UNDISCLOSED = "UNDISCLOSED", _("Prefer not to say")


class BloodType(models.TextChoices):
    A_POS = "A+", "A+"
    A_NEG = "A-", "A-"
    B_POS = "B+", "B+"
    B_NEG = "B-", "B-"
    AB_POS = "AB+", "AB+"
    AB_NEG = "AB-", "AB-"
    O_POS = "O+", "O+"
    O_NEG = "O-", "O-"


class Weekday(models.IntegerChoices):
    MONDAY = 0, _("Monday")
    TUESDAY = 1, _("Tuesday")
    WEDNESDAY = 2, _("Wednesday")
    THURSDAY = 3, _("Thursday")
    FRIDAY = 4, _("Friday")
    SATURDAY = 5, _("Saturday")
    SUNDAY = 6, _("Sunday")


class SlotStatus(models.TextChoices):
    AVAILABLE = "AVAILABLE", _("Available")
    BOOKED = "BOOKED", _("Booked")
    BLOCKED = "BLOCKED", _("Blocked")
    PAST = "PAST", _("Past")


class AppointmentStatus(models.TextChoices):
    PENDING = "PENDING", _("Pending")
    CONFIRMED = "CONFIRMED", _("Confirmed")
    CHECKED_IN = "CHECKED_IN", _("Checked in")
    IN_PROGRESS = "IN_PROGRESS", _("In progress")
    COMPLETED = "COMPLETED", _("Completed")
    CANCELLED = "CANCELLED", _("Cancelled")
    NO_SHOW = "NO_SHOW", _("No show")


class AppointmentType(models.TextChoices):
    SCHEDULED = "SCHEDULED", _("Scheduled")
    WALK_IN = "WALK_IN", _("Walk-in")
    EMERGENCY = "EMERGENCY", _("Emergency")
    FOLLOW_UP = "FOLLOW_UP", _("Follow-up")


class WaitlistStatus(models.TextChoices):
    WAITING = "WAITING", _("Waiting")
    NOTIFIED = "NOTIFIED", _("Notified")
    CONVERTED = "CONVERTED", _("Converted")
    EXPIRED = "EXPIRED", _("Expired")
    CANCELLED = "CANCELLED", _("Cancelled")


class FollowUpStatus(models.TextChoices):
    SUGGESTED = "SUGGESTED", _("Suggested")
    SCHEDULED = "SCHEDULED", _("Scheduled")
    DISMISSED = "DISMISSED", _("Dismissed")
    COMPLETED = "COMPLETED", _("Completed")


class AbsenceType(models.TextChoices):
    VACATION = "VACATION", _("Vacation")
    SICK = "SICK", _("Sick leave")
    CONFERENCE = "CONFERENCE", _("Conference")
    BLOCKED_DATE = "BLOCKED_DATE", _("Blocked date")
    OTHER = "OTHER", _("Other")


class DoctorPatientSource(models.TextChoices):
    APPOINTMENT = "APPOINTMENT", _("Appointment")
    WALK_IN = "WALK_IN", _("Walk-in")
    REFERRAL = "REFERRAL", _("Referral")


class ScanCategory(models.TextChoices):
    XRAY = "XRAY", _("X-Ray")
    MRI = "MRI", _("MRI")
    CT = "CT", _("CT Scan")
    ULTRASOUND = "ULTRASOUND", _("Ultrasound")
    DICOM = "DICOM", _("DICOM")
    OTHER = "OTHER", _("Other")


class LabCategory(models.TextChoices):
    BLOOD = "BLOOD", _("Blood Test")
    URINE = "URINE", _("Urine Test")
    IMAGING = "IMAGING", _("Imaging")
    PATHOLOGY = "PATHOLOGY", _("Pathology")
    OTHER = "OTHER", _("Other")


class PrescriptionStatus(models.TextChoices):
    ACTIVE = "ACTIVE", _("Active")
    COMPLETED = "COMPLETED", _("Completed")
    CANCELLED = "CANCELLED", _("Cancelled")


class AllergySeverity(models.TextChoices):
    MILD = "MILD", _("Mild")
    MODERATE = "MODERATE", _("Moderate")
    SEVERE = "SEVERE", _("Severe")
    CONTRAINDICATED = "CONTRAINDICATED", _("Contraindicated")


class NotificationVerb(models.TextChoices):
    APPT_CONFIRMED = "APPT_CONFIRMED", _("Appointment confirmed")
    APPT_CANCELLED = "APPT_CANCELLED", _("Appointment cancelled")
    APPT_BOOKED = "APPT_BOOKED", _("Appointment booked")
    APPT_REMINDER = "APPT_REMINDER", _("Appointment reminder")
    ABSENCE = "ABSENCE", _("Doctor absence")
    WAITLIST_OPEN = "WAITLIST_OPEN", _("Waitlist slot opened")
    FOLLOWUP = "FOLLOWUP", _("Follow-up")
    REVIEW = "REVIEW", _("Review request")
    GENERIC = "GENERIC", _("Notification")
    # Phase 6 — Lab Orders
    LAB_ORDER_CREATED = "LAB_ORDER_CREATED", _("Lab order created")
    LAB_ORDER_CANCELLED = "LAB_ORDER_CANCELLED", _("Lab order cancelled")
    LAB_RESULT_AVAILABLE = "LAB_RESULT_AVAILABLE", _("Lab result available")
    LAB_RESULT_CRITICAL = "LAB_RESULT_CRITICAL", _("Critical lab result")
    LAB_RESULT_REVIEWED = "LAB_RESULT_REVIEWED", _("Lab result reviewed")
    # Phase 13 — Referrals
    REFERRAL_CREATED = "REFERRAL_CREATED", _("New referral")
    REFERRAL_ACCEPTED = "REFERRAL_ACCEPTED", _("Referral accepted")
    REFERRAL_COMPLETED = "REFERRAL_COMPLETED", _("Referral completed")
    REFERRAL_CANCELLED = "REFERRAL_CANCELLED", _("Referral cancelled")


class LabOrderStatus(models.TextChoices):
    DRAFT = "DRAFT", _("Draft")
    ORDERED = "ORDERED", _("Ordered")
    SAMPLE_COLLECTED = "SAMPLE_COLLECTED", _("Sample collected")
    PROCESSING = "PROCESSING", _("Processing")
    COMPLETED = "COMPLETED", _("Completed")
    REVIEWED = "REVIEWED", _("Reviewed")
    CANCELLED = "CANCELLED", _("Cancelled")


class LabOrderPriority(models.TextChoices):
    ROUTINE = "ROUTINE", _("Routine")
    URGENT = "URGENT", _("Urgent")
    STAT = "STAT", _("STAT")


class SampleType(models.TextChoices):
    SERUM = "SERUM", _("Serum")
    WHOLE_BLOOD = "WHOLE_BLOOD", _("Whole Blood")
    URINE = "URINE", _("Urine")
    CSF = "CSF", _("CSF")
    SWAB = "SWAB", _("Swab")
    STOOL = "STOOL", _("Stool")
    OTHER = "OTHER", _("Other")


# --- Phase 12 — Billing -------------------------------------------------------

class ServiceItemType(models.TextChoices):
    CONSULTATION = "CONSULTATION", _("Consultation")
    LAB_TEST = "LAB_TEST", _("Lab test")
    PROCEDURE = "PROCEDURE", _("Procedure")
    OTHER = "OTHER", _("Other")


class InvoiceStatus(models.TextChoices):
    DRAFT = "DRAFT", _("Draft")
    ISSUED = "ISSUED", _("Issued")
    PAID = "PAID", _("Paid")
    PARTIALLY_PAID = "PARTIALLY_PAID", _("Partially paid")
    CANCELLED = "CANCELLED", _("Cancelled")
    VOID = "VOID", _("Void")


class PaymentMethod(models.TextChoices):
    CASH = "CASH", _("Cash")
    CARD = "CARD", _("Card")
    BANK_TRANSFER = "BANK_TRANSFER", _("Bank transfer")


class BillingSourceType(models.TextChoices):
    APPOINTMENT = "APPOINTMENT", _("Appointment")
    LAB_ORDER = "LAB_ORDER", _("Lab order")


class ReferralType(models.TextChoices):
    INTERNAL = "INTERNAL", _("Internal")
    EXTERNAL = "EXTERNAL", _("External")


class ReferralStatus(models.TextChoices):
    PENDING = "PENDING", _("Pending")
    ACCEPTED = "ACCEPTED", _("Accepted")
    COMPLETED = "COMPLETED", _("Completed")
    CANCELLED = "CANCELLED", _("Cancelled")


class AuditAction(models.TextChoices):
    CREATE = "CREATE", _("Create")
    UPDATE = "UPDATE", _("Update")
    DELETE = "DELETE", _("Delete")
    LOGIN = "LOGIN", _("Login")
    LOGOUT = "LOGOUT", _("Logout")
    ACCESS = "ACCESS", _("Access")
