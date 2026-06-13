"""Serializers for staff-only user creation and management endpoints."""
import secrets
import uuid

from rest_framework import serializers

from apps.core.enums import LanguageChoices, RoleChoices
from apps.doctors.models import DoctorProfile, Specialty

from .models import PatientProfile, User


class CreateDoctorSerializer(serializers.Serializer):
    # User fields
    first_name = serializers.CharField(max_length=150)
    last_name = serializers.CharField(max_length=150)
    email = serializers.EmailField()
    phone = serializers.CharField(max_length=32, required=False, allow_blank=True, default="")
    preferred_language = serializers.ChoiceField(
        choices=LanguageChoices.choices, default=LanguageChoices.EN
    )
    password = serializers.CharField(
        required=False, allow_blank=True, write_only=True, default=""
    )
    # DoctorProfile fields
    license_number = serializers.CharField(max_length=64)
    specialties = serializers.ListField(
        child=serializers.IntegerField(), required=False, default=list
    )
    room_number = serializers.CharField(max_length=32, required=False, allow_blank=True, default="")
    bio = serializers.CharField(required=False, allow_blank=True, default="")
    photo = serializers.ImageField(required=False, allow_null=True, default=None)

    def validate_email(self, value):
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value

    def validate_license_number(self, value):
        if DoctorProfile.objects.filter(license_number=value).exists():
            raise serializers.ValidationError("This license number is already registered.")
        return value

    def validate_specialties(self, value):
        if value:
            found = Specialty.objects.filter(pk__in=value).count()
            if found != len(value):
                raise serializers.ValidationError("One or more specialty IDs are invalid.")
        return value


class CreateSecretarySerializer(serializers.Serializer):
    first_name = serializers.CharField(max_length=150)
    last_name = serializers.CharField(max_length=150)
    email = serializers.EmailField()
    phone = serializers.CharField(max_length=32, required=False, allow_blank=True, default="")
    preferred_language = serializers.ChoiceField(
        choices=LanguageChoices.choices, default=LanguageChoices.EN
    )
    password = serializers.CharField(
        required=False, allow_blank=True, write_only=True, default=""
    )

    def validate_email(self, value):
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value


class CreatePatientSerializer(serializers.Serializer):
    first_name = serializers.CharField(max_length=150)
    last_name = serializers.CharField(max_length=150)
    phone = serializers.CharField(max_length=32, required=False, allow_blank=True, default="")
    email = serializers.EmailField(required=False, allow_blank=True, default="")
    national_id = serializers.CharField(max_length=64, required=False, allow_blank=True, default="")

    def validate(self, attrs):
        phone = attrs.get("phone", "").strip()
        email = attrs.get("email", "").strip()
        if not phone and not email:
            raise serializers.ValidationError(
                {"phone": "Please provide a phone number or email address."}
            )
        if email and User.objects.filter(email=email).exists():
            raise serializers.ValidationError(
                {"email": "A patient with this email already exists."}
            )
        national_id = attrs.get("national_id", "").strip()
        if national_id and PatientProfile.objects.filter(national_id=national_id).exists():
            raise serializers.ValidationError(
                {"national_id": "This national ID is already registered."}
            )
        return attrs

    @staticmethod
    def make_placeholder_email():
        return f"pat_{uuid.uuid4().hex[:12]}@noemail.clinic"


class UserManagementSerializer(serializers.ModelSerializer):
    """Manager edits: name, phone, email."""

    class Meta:
        model = User
        fields = ["first_name", "last_name", "phone", "email"]

    def validate_email(self, value):
        qs = User.objects.filter(email=value).exclude(pk=self.instance.pk if self.instance else None)
        if qs.exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value
