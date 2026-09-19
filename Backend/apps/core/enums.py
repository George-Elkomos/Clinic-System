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
    # A PENDING booking nobody confirmed before the grace window past its
    # scheduled_start passed — distinct from NO_SHOW (which only applies to
    # appointments that *were* confirmed) so reliability scoring can tell
    # "never engaged" apart from "confirmed then didn't show up".
    EXPIRED = "EXPIRED", _("Expired")


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
    # Phase 14 — Clinical Procedures
    PROCEDURE_SCHEDULED = "PROCEDURE_SCHEDULED", _("Procedure scheduled")
    PROCEDURE_COMPLETED = "PROCEDURE_COMPLETED", _("Procedure completed")
    PROCEDURE_CANCELLED = "PROCEDURE_CANCELLED", _("Procedure cancelled")
    # Phase 15 — Radiology Orders
    RADIOLOGY_ORDER_CREATED = "RADIOLOGY_ORDER_CREATED", _("Radiology order created")
    RADIOLOGY_ORDER_COMPLETED = "RADIOLOGY_ORDER_COMPLETED", _("Radiology scan completed")
    RADIOLOGY_ORDER_REPORTED = "RADIOLOGY_ORDER_REPORTED", _("Radiology report available")
    RADIOLOGY_ORDER_CANCELLED = "RADIOLOGY_ORDER_CANCELLED", _("Radiology order cancelled")
    PATIENT_SCAN_UPLOADED = "PATIENT_SCAN_UPLOADED", _("Patient uploaded a scan")
    # Auto-expiry / no-show sweep — secretary-facing only, never sent to the patient.
    APPT_EXPIRED = "APPT_EXPIRED", _("Booking expired")
    APPT_NO_SHOW = "APPT_NO_SHOW", _("Marked as no-show")


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
    RADIOLOGY = "RADIOLOGY", _("Radiology")
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
    PROCEDURE = "PROCEDURE", _("Procedure")
    RADIOLOGY_ORDER = "RADIOLOGY_ORDER", _("Radiology order")


class DepositStatus(models.TextChoices):
    HELD = "HELD", _("Held")
    PARTIALLY_APPLIED = "PARTIALLY_APPLIED", _("Partially applied")
    APPLIED = "APPLIED", _("Applied")
    REFUNDED = "REFUNDED", _("Refunded")


class CashierShiftStatus(models.TextChoices):
    """Financial roadmap Task 11 — a till session. CLOSED is final: the
    counted cash and its variance posting are a financial record, so there
    is no reopen transition."""
    OPEN = "OPEN", _("Open")
    CLOSED = "CLOSED", _("Closed")


class FinancialOperation(models.TextChoices):
    """Financial write operations protected by API/business-level
    idempotency (distinct from the ledger's own JournalEntry.idempotency_key
    — see apps.billing.idempotency's module docstring). Part of the
    (user, operation, key) uniqueness scope on `IdempotentRequest`: the same
    raw client key never collides across two different operation types."""
    ISSUE_REFUND = "ISSUE_REFUND", _("Issue refund")
    ISSUE_CREDIT_NOTE = "ISSUE_CREDIT_NOTE", _("Issue credit note")
    RECORD_CASH_MOVEMENT = "RECORD_CASH_MOVEMENT", _("Record cash movement")
    RECORD_PAYMENT = "RECORD_PAYMENT", _("Record payment")


class IdempotencyStatus(models.TextChoices):
    IN_PROGRESS = "IN_PROGRESS", _("In progress")
    COMPLETED = "COMPLETED", _("Completed")


class CashMovementType(models.TextChoices):
    """Financial roadmap Task 17 — cash moving in/out of a till that is
    *not* a patient payment or refund (those already post through
    `record_payment`/`issue_refund`). Only the two events the roadmap itself
    names (`clinic-accounting-events.md`§3's `CashDeposited`, plus the float
    put into a drawer that the roadmap explicitly calls out as unposted) are
    modelled — a generic "cash in"/"cash out" pair is deliberately not added:
    the roadmap gives no debit/credit rule for an arbitrary till adjustment,
    and inventing one would be exactly the kind of unrequested requirement
    CLAUDE.md warns against."""
    FLOAT_IN = "FLOAT_IN", _("Float added to till")
    BANK_DEPOSIT = "BANK_DEPOSIT", _("Takings deposited to bank")


class ReferralType(models.TextChoices):
    INTERNAL = "INTERNAL", _("Internal")
    EXTERNAL = "EXTERNAL", _("External")


class ReferralStatus(models.TextChoices):
    PENDING = "PENDING", _("Pending")
    ACCEPTED = "ACCEPTED", _("Accepted")
    COMPLETED = "COMPLETED", _("Completed")
    CANCELLED = "CANCELLED", _("Cancelled")


# --- Phase 14 — Clinical Procedures --------------------------------------------

class ProcedureCategory(models.TextChoices):
    MINOR_SURGERY = "MINOR_SURGERY", _("Minor surgery")
    INJECTION = "INJECTION", _("Injection")
    DRESSING = "DRESSING", _("Dressing")
    BIOPSY = "BIOPSY", _("Biopsy")
    OTHER = "OTHER", _("Other")


class ProcedureStatus(models.TextChoices):
    SCHEDULED = "SCHEDULED", _("Scheduled")
    IN_PROGRESS = "IN_PROGRESS", _("In progress")
    COMPLETED = "COMPLETED", _("Completed")
    CANCELLED = "CANCELLED", _("Cancelled")


# --- Phase 15 — Radiology Orders ----------------------------------------------

class RadiologyModality(models.TextChoices):
    XRAY = "XRAY", _("X-Ray")
    MRI = "MRI", _("MRI")
    CT = "CT", _("CT Scan")
    ULTRASOUND = "ULTRASOUND", _("Ultrasound")
    PET = "PET", _("PET Scan")
    OTHER = "OTHER", _("Other")


class RadiologyOrderStatus(models.TextChoices):
    ORDERED = "ORDERED", _("Ordered")
    COMPLETED = "COMPLETED", _("Completed")
    REPORTED = "REPORTED", _("Reported")
    CANCELLED = "CANCELLED", _("Cancelled")


class RadiologyOrderPriority(models.TextChoices):
    ROUTINE = "ROUTINE", _("Routine")
    URGENT = "URGENT", _("Urgent")


class AuditAction(models.TextChoices):
    CREATE = "CREATE", _("Create")
    UPDATE = "UPDATE", _("Update")
    DELETE = "DELETE", _("Delete")
    LOGIN = "LOGIN", _("Login")
    LOGOUT = "LOGOUT", _("Logout")
    ACCESS = "ACCESS", _("Access")


# --- Financial roadmap Task 4 — Accounting core --------------------------------

class RootType(models.TextChoices):
    ASSET = "ASSET", _("Asset")
    LIABILITY = "LIABILITY", _("Liability")
    INCOME = "INCOME", _("Income")
    EXPENSE = "EXPENSE", _("Expense")
    EQUITY = "EQUITY", _("Equity")


class AccountType(models.TextChoices):
    RECEIVABLE = "RECEIVABLE", _("Receivable")
    PAYABLE = "PAYABLE", _("Payable")
    CASH = "CASH", _("Cash")
    BANK = "BANK", _("Bank")
    INCOME = "INCOME", _("Income")
    EXPENSE = "EXPENSE", _("Expense")
    TAX = "TAX", _("Tax")
    INVENTORY = "INVENTORY", _("Inventory")
    COGS = "COGS", _("Cost of goods sold")
    FIXED_ASSET = "FIXED_ASSET", _("Fixed asset")
    ACCUMULATED_DEPRECIATION = "ACCUMULATED_DEPRECIATION", _("Accumulated depreciation")
    EQUITY = "EQUITY", _("Equity")
    PATIENT_DEPOSIT = "PATIENT_DEPOSIT", _("Patient deposit")
    CONTRACTUAL_ADJUSTMENT = "CONTRACTUAL_ADJUSTMENT", _("Contractual adjustment")
    WRITE_OFF = "WRITE_OFF", _("Write off")
    ROUND_OFF = "ROUND_OFF", _("Round off")
    DEFERRED_REVENUE = "DEFERRED_REVENUE", _("Deferred revenue")


class ReportSection(models.TextChoices):
    """Which financial statement an account's root_type feeds into."""
    BALANCE_SHEET = "BALANCE_SHEET", _("Balance sheet")
    PROFIT_AND_LOSS = "PROFIT_AND_LOSS", _("Profit and loss")


class FiscalYearStatus(models.TextChoices):
    OPEN = "OPEN", _("Open")
    CLOSED = "CLOSED", _("Closed")


class PeriodStatus(models.TextChoices):
    OPEN = "OPEN", _("Open")
    SOFT_CLOSED = "SOFT_CLOSED", _("Soft closed")
    CLOSED = "CLOSED", _("Closed")


# --- Phase 16 — Advanced Analytics ---------------------------------------------

class PeriodChoices(models.TextChoices):
    """Calendar-aligned period keys for Phase 16 analytics (apps.core.periods).

    Not used by the older rolling week/month/all lookback in
    apps.reports.services._period_start, nor by the day/month/year
    calendar-aligned logic in apps.billing.services._period_start — both of
    those pre-existing, independent implementations are left untouched.
    """
    WEEK = "week", _("Week")
    MONTH = "month", _("Month")
    YEAR = "year", _("Year")
