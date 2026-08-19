"""Dual-language name fields (name_ar/name_en), Accept-Language-driven
serializer localization, and EGP currency defaults.

Covers: User.name_ar/name_en fallback + first/last-name derivation on save(),
staff-creation validation (name_ar required, name_en optional), the shared
apps.core.i18n helpers, per-serializer Accept-Language localization for
Encounters/Invoices/AuditLogs/Reviews/Appointments, the DoctorProfile
full_name_ar -> User.name_ar migration, and the billing currency default.
"""
from datetime import timedelta
from decimal import Decimal

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.appointments.models import Appointment
from apps.audit.models import AuditLog
from apps.billing.models import Invoice, InvoiceItem, ServiceItem
from apps.core.enums import (
    AppointmentStatus,
    AuditAction,
    InvoiceStatus,
    RoleChoices,
    ServiceItemType,
)
from apps.core.i18n import get_request_locale, localized_name
from apps.doctors.models import DoctorProfile
from apps.encounters.models import Encounter, EncounterStatus
from apps.reviews.models import Review
from apps.users.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture
def manager(make_user):
    return make_user("mgr@i18n.dev", RoleChoices.MANAGER)


# --------------------------------------------------------------------------
# User.name_ar/name_en: fallback + first/last-name derivation on save()
# --------------------------------------------------------------------------

class TestUserNameFallback:
    def test_blank_name_en_falls_back_to_name_ar(self, make_user):
        user = make_user("nofallback@i18n.dev", RoleChoices.PATIENT, name_ar="منى عدلي")
        assert user.name_en == "منى عدلي"

    def test_explicit_name_en_is_kept(self, make_user):
        user = make_user(
            "explicit@i18n.dev", RoleChoices.PATIENT, name_ar="منى عدلي", name_en="Mona Adly",
        )
        assert user.name_en == "Mona Adly"

    def test_first_last_name_derived_from_display_name(self, make_user):
        user = make_user(
            "derived@i18n.dev", RoleChoices.PATIENT, name_ar="منى عدلي", name_en="Mona Adly",
        )
        assert user.first_name == "Mona"
        assert user.last_name == "Adly"

    def test_first_last_name_untouched_when_no_dual_language_name_given(self, make_user):
        """Existing callers that only ever set first_name/last_name directly
        (fixtures, seed scripts, Django admin) must keep working unchanged."""
        user = make_user("plain@i18n.dev", RoleChoices.PATIENT, first_name="Joe", last_name="Doe")
        assert user.first_name == "Joe"
        assert user.last_name == "Doe"
        assert user.name_ar == ""


# --------------------------------------------------------------------------
# Staff/patient creation: name_ar required, name_en optional
# --------------------------------------------------------------------------

class TestStaffCreationValidation:
    def test_doctor_creation_requires_name_ar(self, api, manager):
        api.force_authenticate(manager)
        resp = api.post(reverse("staff-create-doctor"), {
            "email": "noname@i18n.dev", "license_number": "LIC-I18N-1",
        }, format="json")
        assert resp.status_code == 400
        assert "name_ar" in resp.data["fields"]

    def test_doctor_creation_name_en_optional_falls_back(self, api, manager):
        api.force_authenticate(manager)
        resp = api.post(reverse("staff-create-doctor"), {
            "name_ar": "منى عدلي", "email": "mona@i18n.dev", "license_number": "LIC-I18N-2",
        }, format="json")
        assert resp.status_code == 201
        user = User.objects.get(email="mona@i18n.dev")
        assert user.name_ar == "منى عدلي"
        assert user.name_en == "منى عدلي"

    def test_patient_creation_requires_name_ar(self, api, secretary):
        api.force_authenticate(secretary)
        resp = api.post(reverse("staff-create-patient"), {"phone": "0500009999"}, format="json")
        assert resp.status_code == 400
        assert "name_ar" in resp.data["fields"]

    def test_patient_creation_with_name_ar_only(self, api, secretary):
        api.force_authenticate(secretary)
        resp = api.post(reverse("staff-create-patient"), {
            "name_ar": "عمر حسن", "phone": "0500008888",
        }, format="json")
        assert resp.status_code == 201
        user = User.objects.get(pk=resp.data["user"]["id"])
        assert user.name_ar == "عمر حسن"
        assert user.name_en == "عمر حسن"


# --------------------------------------------------------------------------
# apps.core.i18n helpers
# --------------------------------------------------------------------------

class FakeRequest:
    def __init__(self, accept_language=""):
        self.headers = {"Accept-Language": accept_language} if accept_language else {}


class TestLocaleHelpers:
    @pytest.mark.parametrize("header,expected", [
        ("ar", "ar"), ("ar-EG", "ar"), ("ar;q=0.9,en;q=0.8", "ar"),
        ("en", "en"), ("en-US,en;q=0.5", "en"), ("", "en"), ("fr-FR", "en"),
    ])
    def test_get_request_locale(self, header, expected):
        assert get_request_locale(FakeRequest(header)) == expected

    def test_get_request_locale_handles_none_request(self):
        assert get_request_locale(None) == "en"

    def test_localized_name_prefers_requested_locale(self, make_user):
        user = make_user("both@i18n.dev", RoleChoices.PATIENT, name_ar="عمر حسن", name_en="Omar Hassan")
        assert localized_name(user, "ar") == "عمر حسن"
        assert localized_name(user, "en") == "Omar Hassan"

    def test_localized_name_falls_back_to_other_language(self, make_user):
        user = make_user("ar-only@i18n.dev", RoleChoices.PATIENT, name_ar="عمر حسن")
        # name_en auto-fell back to name_ar on save(), so both locales resolve.
        assert localized_name(user, "en") == "عمر حسن"

    def test_localized_name_falls_back_to_existing_name_field(self, make_user):
        """No dual-language name at all -- falls back to first/last name, the
        'existing name field' from before this feature."""
        user = make_user("legacy@i18n.dev", RoleChoices.PATIENT, first_name="Joe", last_name="Doe")
        assert localized_name(user, "ar") == "Joe Doe"
        assert localized_name(user, "en") == "Joe Doe"

    def test_localized_name_falls_back_to_email_when_no_name_at_all(self, make_user):
        user = make_user("bare@i18n.dev", RoleChoices.PATIENT)
        assert localized_name(user, "en") == "bare@i18n.dev"

    def test_localized_name_none_user_returns_none(self):
        assert localized_name(None, "en") is None


# --------------------------------------------------------------------------
# Serializer Accept-Language localization
# --------------------------------------------------------------------------

class TestAppointmentLocalization:
    def test_doctor_and_patient_name_follow_accept_language(self, api, make_user, doctor_profile):
        doctor_profile.user.name_ar = "منى عدلي"
        doctor_profile.user.name_en = "Mona Adly"
        doctor_profile.user.save()
        patient = make_user("appt-pat@i18n.dev", RoleChoices.PATIENT, name_ar="عمر حسن", name_en="Omar Hassan")
        appt = Appointment.objects.create(
            patient=patient.patient_profile, doctor=doctor_profile,
            scheduled_start=timezone.now() + timedelta(days=1),
            scheduled_end=timezone.now() + timedelta(days=1, minutes=30),
            status=AppointmentStatus.CONFIRMED,
        )
        api.force_authenticate(doctor_profile.user)

        resp_ar = api.get(reverse("appointment-detail", args=[appt.id]), HTTP_ACCEPT_LANGUAGE="ar")
        assert resp_ar.data["doctor_name"] == "منى عدلي"
        assert resp_ar.data["patient_name"] == "عمر حسن"

        resp_en = api.get(reverse("appointment-detail", args=[appt.id]), HTTP_ACCEPT_LANGUAGE="en")
        assert resp_en.data["doctor_name"] == "Mona Adly"
        assert resp_en.data["patient_name"] == "Omar Hassan"

        # No header at all -> defaults to English.
        resp_default = api.get(reverse("appointment-detail", args=[appt.id]))
        assert resp_default.data["doctor_name"] == "Mona Adly"


class TestReviewLocalization:
    def test_moderation_view_localizes_names(self, api, manager, make_user, doctor_profile):
        doctor_profile.user.name_ar = "منى عدلي"
        doctor_profile.user.name_en = "Mona Adly"
        doctor_profile.user.save()
        patient = make_user("rev-pat@i18n.dev", RoleChoices.PATIENT, name_ar="عمر حسن", name_en="Omar Hassan")
        Review.objects.create(patient=patient.patient_profile, doctor=doctor_profile, rating=5)

        api.force_authenticate(manager)
        resp = api.get(reverse("review-list"), HTTP_ACCEPT_LANGUAGE="ar")
        row = resp.data["results"][0] if isinstance(resp.data, dict) else resp.data[0]
        assert row["doctor_name"] == "منى عدلي"
        assert row["patient_name"] == "عمر حسن"


class TestEncounterLocalization:
    def test_encounter_names_follow_accept_language(self, api, make_user, doctor_profile):
        doctor_profile.user.name_ar = "منى عدلي"
        doctor_profile.user.name_en = "Mona Adly"
        doctor_profile.user.save()
        patient = make_user("enc-pat@i18n.dev", RoleChoices.PATIENT, name_ar="عمر حسن", name_en="Omar Hassan")
        encounter = Encounter.objects.create(
            patient=patient.patient_profile, doctor=doctor_profile, status=EncounterStatus.DRAFT,
        )
        api.force_authenticate(doctor_profile.user)

        resp = api.get(reverse("encounter-detail", args=[encounter.id]), HTTP_ACCEPT_LANGUAGE="ar")
        assert resp.data["doctor_name"] == "منى عدلي"
        assert resp.data["patient_name"] == "عمر حسن"


class TestInvoiceLocalization:
    def test_invoice_names_and_item_description_follow_accept_language(
        self, api, manager, make_user, doctor_profile,
    ):
        doctor_profile.user.name_ar = "منى عدلي"
        doctor_profile.user.name_en = "Mona Adly"
        doctor_profile.user.save()
        patient = make_user("inv-pat@i18n.dev", RoleChoices.PATIENT, name_ar="عمر حسن", name_en="Omar Hassan")
        consultation = ServiceItem.objects.create(
            name="General Consultation", name_ar="كشف عام",
            item_type=ServiceItemType.CONSULTATION, default_price=Decimal("50.00"),
        )
        invoice = Invoice.objects.create(
            patient=patient, doctor=doctor_profile.user, status=InvoiceStatus.ISSUED,
        )
        InvoiceItem.objects.create(
            invoice=invoice, description=consultation.name, service_item=consultation,
            quantity=1, unit_price=Decimal("50.00"),
        )

        api.force_authenticate(manager)
        resp_ar = api.get(reverse("invoice-detail", args=[invoice.id]), HTTP_ACCEPT_LANGUAGE="ar")
        assert resp_ar.data["doctor_name"] == "منى عدلي"
        assert resp_ar.data["patient_name"] == "عمر حسن"
        assert resp_ar.data["items"][0]["description"] == "كشف عام"

        resp_en = api.get(reverse("invoice-detail", args=[invoice.id]), HTTP_ACCEPT_LANGUAGE="en")
        assert resp_en.data["doctor_name"] == "Mona Adly"
        assert resp_en.data["items"][0]["description"] == "General Consultation"

    def test_invoice_currency_defaults_to_egp(self, patient, doctor_profile):
        invoice = Invoice.objects.create(patient=patient, doctor=doctor_profile.user)
        assert invoice.currency == "EGP"

    def test_billing_currency_setting_is_egp(self, settings):
        assert settings.BILLING_CURRENCY == "EGP"


class TestAuditLogLocalization:
    def test_actor_name_follows_accept_language(self, api, manager, make_user):
        actor = make_user("audit-actor@i18n.dev", RoleChoices.SECRETARY, name_ar="سارة الإدارية", name_en="Sara Admin")
        entry = AuditLog.objects.create(
            actor=actor, action=AuditAction.UPDATE, model_name="User", object_id=str(actor.pk),
        )
        api.force_authenticate(manager)

        resp_ar = api.get(reverse("audit-log-list"), {"search": ""}, HTTP_ACCEPT_LANGUAGE="ar")
        row = next(r for r in resp_ar.data["results"] if r["id"] == entry.id)
        assert row["actor_name"] == "سارة الإدارية"

        resp_en = api.get(reverse("audit-log-list"), HTTP_ACCEPT_LANGUAGE="en")
        row = next(r for r in resp_en.data["results"] if r["id"] == entry.id)
        assert row["actor_name"] == "Sara Admin"

    def test_actor_name_blank_when_actor_is_none(self, api, manager):
        entry = AuditLog.objects.create(actor=None, action=AuditAction.LOGIN, model_name="")
        api.force_authenticate(manager)
        resp = api.get(reverse("audit-log-list"))
        row = next(r for r in resp.data["results"] if r["id"] == entry.id)
        assert row["actor_name"] == ""


# --------------------------------------------------------------------------
# DoctorProfile.full_name_ar -> User.name_ar migration + write-through
# --------------------------------------------------------------------------

class TestDoctorNameArMigration:
    def test_full_name_ar_field_no_longer_exists(self):
        assert not hasattr(DoctorProfile, "full_name_ar")
        assert "full_name_ar" not in [f.name for f in DoctorProfile._meta.get_fields()]

    def test_doctor_profile_write_serializer_updates_user_name(self, api, doctor_profile):
        api.force_authenticate(doctor_profile.user)
        resp = api.patch(
            reverse("doctor-detail", args=[doctor_profile.id]),
            {"name_ar": "منى عدلي", "name_en": "Mona Adly"},
            format="json",
        )
        assert resp.status_code == 200
        doctor_profile.user.refresh_from_db()
        assert doctor_profile.user.name_ar == "منى عدلي"
        assert doctor_profile.user.name_en == "Mona Adly"

    def test_doctor_profile_read_serializer_exposes_name_ar_name_en(self, api, doctor_profile, manager):
        doctor_profile.user.name_ar = "منى عدلي"
        doctor_profile.user.name_en = "Mona Adly"
        doctor_profile.user.save()
        api.force_authenticate(manager)
        resp = api.get(reverse("doctor-detail", args=[doctor_profile.id]))
        assert resp.data["name_ar"] == "منى عدلي"
        assert resp.data["name_en"] == "Mona Adly"
