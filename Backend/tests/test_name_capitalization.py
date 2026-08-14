import pytest

from apps.core.enums import RoleChoices
from apps.doctors.models import Specialty, SpecialtyCategory
from apps.users.models import User

pytestmark = pytest.mark.django_db


class TestUserNameCapitalization:
    def test_lowercase_names_are_capitalized_on_save(self):
        user = User.objects.create_user(
            email="lowercase@test.dev", password="Clinic123!", role=RoleChoices.PATIENT,
            first_name="ahmed", last_name="hassan",
        )
        assert user.first_name == "Ahmed"
        assert user.last_name == "Hassan"

    def test_already_correct_internal_casing_is_untouched(self):
        """McDonald/AlSayed-style names must not be mangled by title-casing."""
        user = User.objects.create_user(
            email="mixedcase@test.dev", password="Clinic123!", role=RoleChoices.PATIENT,
            first_name="McDonald", last_name="AlSayed",
        )
        assert user.first_name == "McDonald"
        assert user.last_name == "AlSayed"

    def test_blank_names_stay_blank(self):
        user = User.objects.create_user(
            email="blank@test.dev", password="Clinic123!", role=RoleChoices.PATIENT,
        )
        assert user.first_name == ""
        assert user.last_name == ""

    def test_update_via_save_also_normalizes(self):
        user = User.objects.create_user(
            email="update@test.dev", password="Clinic123!", role=RoleChoices.PATIENT,
            first_name="Sam", last_name="original",
        )
        user.last_name = "renamed"
        user.save()
        assert user.last_name == "Renamed"


class TestSpecialtyNameCapitalization:
    def test_lowercase_specialty_name_is_capitalized_on_save(self):
        category = SpecialtyCategory.objects.create(name="General")
        specialty = Specialty.objects.create(name="cardiology", category=category)
        assert specialty.name == "Cardiology"

    def test_arabic_name_is_untouched(self):
        category = SpecialtyCategory.objects.create(name="General 2")
        specialty = Specialty.objects.create(
            name="Dermatology", name_ar="جلدية", category=category,
        )
        assert specialty.name_ar == "جلدية"
