"""Field-level RBAC on the shared doctor-profile write endpoint
(`PATCH /doctors/<id>/`): consultation_fee/room_number are Manager-exclusive,
photo is doctor-exclusive, and the rest (bio, experience, languages, etc.) is
shared between the doctor and secretary/manager."""
import base64

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse

from apps.core.enums import RoleChoices

pytestmark = pytest.mark.django_db

# A real (Pillow-valid) 1x1 transparent PNG — DoctorProfile.photo is an
# ImageField, which rejects the placeholder byte strings used for FileField tests.
_PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


@pytest.fixture
def manager(make_user):
    return make_user("mgr-doc@test.dev", RoleChoices.MANAGER, first_name="Man", last_name="Ager")


def _patch(api, user, doctor_profile, data):
    api.force_authenticate(user)
    return api.patch(reverse("doctor-detail", args=[doctor_profile.id]), data, format="json")


def test_doctor_cannot_change_own_fee_or_room(api, doctor_profile):
    resp = _patch(api, doctor_profile.user, doctor_profile, {
        "consultation_fee": "999.00", "room_number": "999",
    })
    assert resp.status_code == 200
    doctor_profile.refresh_from_db()
    assert str(doctor_profile.consultation_fee or "") != "999.00"
    assert doctor_profile.room_number != "999"


def test_secretary_cannot_change_fee_or_room(api, secretary, doctor_profile):
    resp = _patch(api, secretary, doctor_profile, {
        "consultation_fee": "999.00", "room_number": "999",
    })
    assert resp.status_code == 200
    doctor_profile.refresh_from_db()
    assert str(doctor_profile.consultation_fee or "") != "999.00"
    assert doctor_profile.room_number != "999"


def test_manager_can_change_fee_and_room(api, manager, doctor_profile):
    resp = _patch(api, manager, doctor_profile, {
        "consultation_fee": "150.00", "room_number": "12B",
    })
    assert resp.status_code == 200
    doctor_profile.refresh_from_db()
    assert str(doctor_profile.consultation_fee) == "150.00"
    assert doctor_profile.room_number == "12B"


def test_shared_fields_editable_by_doctor_and_manager(api, manager, doctor_profile):
    resp = _patch(api, doctor_profile.user, doctor_profile, {"bio": "Doctor-written bio"})
    assert resp.status_code == 200
    doctor_profile.refresh_from_db()
    assert doctor_profile.bio == "Doctor-written bio"

    resp = _patch(api, manager, doctor_profile, {"bio": "Manager-written bio"})
    assert resp.status_code == 200
    doctor_profile.refresh_from_db()
    assert doctor_profile.bio == "Manager-written bio"


def _patch_photo(api, user, doctor_profile, filename):
    api.force_authenticate(user)
    upload = SimpleUploadedFile(filename, _PNG_BYTES, content_type="image/png")
    return api.patch(reverse("doctor-detail", args=[doctor_profile.id]), {"photo": upload}, format="multipart")


def test_secretary_cannot_set_doctor_photo(api, secretary, doctor_profile):
    resp = _patch_photo(api, secretary, doctor_profile, "sec-upload.png")
    assert resp.status_code == 200
    doctor_profile.refresh_from_db()
    assert not doctor_profile.photo


def test_manager_cannot_set_doctor_photo(api, manager, doctor_profile):
    resp = _patch_photo(api, manager, doctor_profile, "mgr-upload.png")
    assert resp.status_code == 200
    doctor_profile.refresh_from_db()
    assert not doctor_profile.photo


def test_doctor_can_set_own_photo(api, doctor_profile):
    resp = _patch_photo(api, doctor_profile.user, doctor_profile, "self-upload.png")
    assert resp.status_code == 200
    doctor_profile.refresh_from_db()
    assert doctor_profile.photo
