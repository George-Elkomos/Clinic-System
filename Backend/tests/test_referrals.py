"""Phase 13 — Referral tests.

Covers internal/external validation, encounter-ownership on create, role-based
visibility (patient/doctor/manager, secretary excluded), the accept/complete/
cancel lifecycle including recipient eligibility, and the side effects
(notifications, DoctorPatient linkage on complete).
"""
import pytest
from django.urls import reverse

from apps.core.enums import DoctorPatientSource, NotificationVerb, ReferralStatus, RoleChoices
from apps.doctors.models import DoctorPatient, DoctorProfile, Specialty, SpecialtyCategory
from apps.encounters.models import Encounter, EncounterStatus
from apps.notifications.models import Notification
from apps.referrals.models import Referral

pytestmark = pytest.mark.django_db


@pytest.fixture
def manager(make_user):
    return make_user("mgr@test.dev", RoleChoices.MANAGER, first_name="Man", last_name="Ager")


@pytest.fixture
def specialty(doctor_profile):
    return doctor_profile.specialties.first()


@pytest.fixture
def other_specialty():
    category = SpecialtyCategory.objects.create(name="Cardiology")
    return Specialty.objects.create(name="Cardiology", category=category)


@pytest.fixture
def doctor2(make_user, specialty):
    """A second doctor in the SAME specialty as doctor_profile — the "any doctor
    in the specialty" recipient scenario."""
    user = make_user("doc2@test.dev", RoleChoices.DOCTOR, first_name="Dee", last_name="Two")
    profile = DoctorProfile.objects.create(user=user, license_number="LIC-T2", avg_appointment_duration=30)
    profile.specialties.add(specialty)
    return profile


@pytest.fixture
def encounter(patient, doctor_profile):
    return Encounter.objects.create(
        patient=patient.patient_profile, doctor=doctor_profile, status=EncounterStatus.DRAFT,
    )


def _create_payload(encounter, **overrides):
    payload = {
        "encounter": encounter.id,
        "referral_type": "EXTERNAL",
        "external_facility_name": "City General Hospital",
        "reason": "Suspected fracture, needs imaging.",
    }
    payload.update(overrides)
    return payload


class TestReferralCreateValidation:
    def test_internal_requires_specialty(self, api, doctor_profile, encounter):
        api.force_authenticate(doctor_profile.user)
        resp = api.post(reverse("referral-list"), _create_payload(
            encounter, referral_type="INTERNAL", external_facility_name="",
        ), format="json")
        assert resp.status_code == 400
        assert "specialty" in resp.data["fields"]

    def test_external_requires_facility_name(self, api, doctor_profile, encounter):
        api.force_authenticate(doctor_profile.user)
        resp = api.post(reverse("referral-list"), _create_payload(
            encounter, external_facility_name="",
        ), format="json")
        assert resp.status_code == 400
        assert "external_facility_name" in resp.data["fields"]

    def test_internal_rejects_facility_name(self, api, doctor_profile, specialty, encounter):
        api.force_authenticate(doctor_profile.user)
        resp = api.post(reverse("referral-list"), _create_payload(
            encounter, referral_type="INTERNAL", specialty=specialty.id,
            external_facility_name="Some Hospital",
        ), format="json")
        assert resp.status_code == 400

    def test_target_doctor_must_belong_to_specialty(
        self, api, doctor_profile, specialty, other_specialty, doctor2, encounter
    ):
        # doctor2 is in `specialty`, not `other_specialty`.
        api.force_authenticate(doctor_profile.user)
        resp = api.post(reverse("referral-list"), _create_payload(
            encounter, referral_type="INTERNAL", specialty=other_specialty.id,
            target_doctor=doctor2.id, external_facility_name="",
        ), format="json")
        assert resp.status_code == 400

    def test_valid_external_referral_created(self, api, doctor_profile, encounter, patient):
        api.force_authenticate(doctor_profile.user)
        resp = api.post(reverse("referral-list"), _create_payload(encounter), format="json")
        assert resp.status_code == 201
        assert resp.data["status"] == ReferralStatus.PENDING
        assert resp.data["patient"] == patient.patient_profile.id
        assert resp.data["referring_doctor"] == doctor_profile.id

    def test_valid_internal_referral_with_target_doctor(
        self, api, doctor_profile, specialty, doctor2, encounter
    ):
        api.force_authenticate(doctor_profile.user)
        resp = api.post(reverse("referral-list"), _create_payload(
            encounter, referral_type="INTERNAL", specialty=specialty.id,
            target_doctor=doctor2.id, external_facility_name="",
        ), format="json")
        assert resp.status_code == 201
        assert resp.data["target_doctor"] == doctor2.id
        # The target doctor gets an in-app notification.
        assert Notification.objects.filter(
            recipient=doctor2.user, verb=NotificationVerb.REFERRAL_CREATED,
        ).exists()


class TestReferralCreatePermissions:
    def test_only_owning_doctor_can_refer_from_an_encounter(self, api, doctor2, encounter):
        api.force_authenticate(doctor2.user)
        resp = api.post(reverse("referral-list"), _create_payload(encounter), format="json")
        assert resp.status_code == 403

    def test_patient_cannot_create_referral(self, api, patient, encounter):
        api.force_authenticate(patient)
        resp = api.post(reverse("referral-list"), _create_payload(encounter), format="json")
        assert resp.status_code == 403

    def test_secretary_cannot_create_or_act_on_referrals(self, api, secretary, doctor_profile, encounter):
        api.force_authenticate(secretary)
        assert api.post(reverse("referral-list"), _create_payload(encounter), format="json").status_code == 403

        referral = Referral.objects.create(
            patient=encounter.patient, referring_doctor=doctor_profile, encounter=encounter,
            referral_type="EXTERNAL", external_facility_name="Some Hospital", reason="x",
        )
        assert api.post(reverse("referral-accept", args=[referral.id])).status_code == 403
        assert api.post(reverse("referral-complete", args=[referral.id])).status_code == 403
        assert api.post(reverse("referral-cancel", args=[referral.id])).status_code == 403

    def test_secretary_has_read_only_access_without_clinical_fields(
        self, api, secretary, doctor_profile, encounter
    ):
        referral = Referral.objects.create(
            patient=encounter.patient, referring_doctor=doctor_profile, encounter=encounter,
            referral_type="EXTERNAL", external_facility_name="Some Hospital",
            reason="Suspected fracture", notes="handle with care",
        )
        api.force_authenticate(secretary)
        list_resp = api.get(reverse("referral-list"))
        assert list_resp.status_code == 200
        assert list_resp.data["count"] == 1
        row = list_resp.data["results"][0]
        assert "reason" not in row and "reason_ar" not in row
        assert "notes" not in row and "notes_ar" not in row
        assert row["external_facility_name"] == "Some Hospital"

        detail_resp = api.get(reverse("referral-detail", args=[referral.id]))
        assert detail_resp.status_code == 200
        assert "reason" not in detail_resp.data


class TestReferralVisibility:
    def test_patient_sees_only_own_referrals(
        self, api, doctor_profile, encounter, patient, patient2
    ):
        Referral.objects.create(
            patient=patient.patient_profile, referring_doctor=doctor_profile, encounter=encounter,
            referral_type="EXTERNAL", external_facility_name="Some Hospital", reason="x",
        )
        api.force_authenticate(patient)
        assert api.get(reverse("referral-list")).data["count"] == 1

        api.force_authenticate(patient2)
        assert api.get(reverse("referral-list")).data["count"] == 0

    def test_doctor_sees_referrals_they_made_and_unassigned_specialty_referrals(
        self, api, doctor_profile, specialty, doctor2, encounter
    ):
        Referral.objects.create(
            patient=encounter.patient, referring_doctor=doctor_profile, encounter=encounter,
            referral_type="INTERNAL", specialty=specialty, reason="heart murmur",
        )
        api.force_authenticate(doctor2.user)
        resp = api.get(reverse("referral-list"))
        assert resp.data["count"] == 1  # visible via the unassigned specialty match

    def test_manager_sees_all(self, api, manager, doctor_profile, encounter):
        Referral.objects.create(
            patient=encounter.patient, referring_doctor=doctor_profile, encounter=encounter,
            referral_type="EXTERNAL", external_facility_name="X", reason="x",
        )
        api.force_authenticate(manager)
        assert api.get(reverse("referral-list")).data["count"] == 1


class TestReferralLifecycle:
    @pytest.fixture
    def internal_referral(self, doctor_profile, specialty, encounter):
        return Referral.objects.create(
            patient=encounter.patient, referring_doctor=doctor_profile, encounter=encounter,
            referral_type="INTERNAL", specialty=specialty, reason="heart murmur",
        )

    def test_doctor_in_specialty_can_accept_unassigned_referral(
        self, api, doctor2, internal_referral
    ):
        api.force_authenticate(doctor2.user)
        resp = api.post(reverse("referral-accept", args=[internal_referral.id]))
        assert resp.status_code == 200
        internal_referral.refresh_from_db()
        assert internal_referral.status == ReferralStatus.ACCEPTED
        assert internal_referral.accepted_by_id == doctor2.id

    def test_unrelated_doctor_cannot_accept(self, api, make_user, internal_referral):
        outsider_user = make_user("outsider@test.dev", RoleChoices.DOCTOR, first_name="Out", last_name="Sider")
        DoctorProfile.objects.create(user=outsider_user, license_number="LIC-OUT")
        api.force_authenticate(outsider_user)
        resp = api.post(reverse("referral-accept", args=[internal_referral.id]))
        assert resp.status_code in (403, 404)

    def test_only_accepter_can_complete(self, api, doctor2, doctor_profile, internal_referral):
        api.force_authenticate(doctor2.user)
        api.post(reverse("referral-accept", args=[internal_referral.id]))

        # The referring doctor (not the accepter) tries to complete — rejected.
        api.force_authenticate(doctor_profile.user)
        resp = api.post(reverse("referral-complete", args=[internal_referral.id]))
        assert resp.status_code == 403

        api.force_authenticate(doctor2.user)
        resp = api.post(reverse("referral-complete", args=[internal_referral.id]))
        assert resp.status_code == 200
        internal_referral.refresh_from_db()
        assert internal_referral.status == ReferralStatus.COMPLETED

        link = DoctorPatient.objects.get(doctor=doctor2, patient=internal_referral.patient)
        assert link.source == DoctorPatientSource.REFERRAL

        assert Notification.objects.filter(
            recipient=doctor_profile.user, verb=NotificationVerb.REFERRAL_COMPLETED,
        ).exists()

    def test_referring_doctor_can_cancel_pending(self, api, doctor_profile, internal_referral):
        api.force_authenticate(doctor_profile.user)
        resp = api.post(reverse("referral-cancel", args=[internal_referral.id]))
        assert resp.status_code == 200
        internal_referral.refresh_from_db()
        assert internal_referral.status == ReferralStatus.CANCELLED

    def test_manager_can_cancel(self, api, manager, internal_referral):
        api.force_authenticate(manager)
        resp = api.post(reverse("referral-cancel", args=[internal_referral.id]))
        assert resp.status_code == 200

    def test_unrelated_doctor_cannot_cancel(self, api, doctor2, internal_referral):
        # doctor2 is a valid recipient (read access) but didn't create the referral.
        api.force_authenticate(doctor2.user)
        resp = api.post(reverse("referral-cancel", args=[internal_referral.id]))
        assert resp.status_code == 403

    def test_cannot_accept_already_accepted_referral(self, api, doctor2, internal_referral):
        api.force_authenticate(doctor2.user)
        api.post(reverse("referral-accept", args=[internal_referral.id]))
        resp = api.post(reverse("referral-accept", args=[internal_referral.id]))
        assert resp.status_code == 400

    def test_patient_cannot_accept_or_cancel(self, api, patient, internal_referral):
        api.force_authenticate(patient)
        assert api.post(reverse("referral-accept", args=[internal_referral.id])).status_code == 403
        assert api.post(reverse("referral-cancel", args=[internal_referral.id])).status_code == 403
