from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from apps.core.enums import RoleChoices

from .models import NotificationPreference, PatientProfile, StaffProfile, User


class UserSerializer(serializers.ModelSerializer):
    full_name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id", "email", "role", "first_name", "last_name", "full_name",
            "phone", "preferred_language", "is_active", "date_joined",
            "must_change_password",
        ]
        read_only_fields = ["id", "role", "is_active", "date_joined", "must_change_password"]

    def get_full_name(self, obj):
        return obj.get_full_name()


def build_user_payload(user):
    """Full current-user representation: base fields + nested patient/doctor/
    staff profile + notification prefs. Shared by login and /auth/me so the
    `user` object is identical no matter which call produced it (otherwise the
    doctor profile is missing right after login and only appears after a
    refresh)."""
    data = UserSerializer(user).data
    profile = getattr(user, "patient_profile", None)
    data["patient_profile"] = PatientProfileSerializer(profile).data if profile else None
    prefs = getattr(user, "notification_preference", None)
    data["notification_preference"] = (
        NotificationPreferenceSerializer(prefs).data if prefs else None
    )
    doctor_profile = getattr(user, "doctor_profile", None)
    if doctor_profile is not None:
        from apps.doctors.serializers import DoctorProfileSerializer

        data["doctor_profile"] = DoctorProfileSerializer(doctor_profile).data
    staff_profile = getattr(user, "staff_profile", None)
    data["staff_profile"] = StaffProfileSerializer(staff_profile).data if staff_profile else None
    # Single field the frontend can read regardless of role — doctors' avatar
    # lives on DoctorProfile.photo (already used by public listings), every
    # other role uses User.avatar.
    if doctor_profile is not None and doctor_profile.photo:
        data["avatar_url"] = doctor_profile.photo.url
    elif user.avatar:
        data["avatar_url"] = user.avatar.url
    else:
        data["avatar_url"] = None
    return data


class MeUpdateSerializer(serializers.ModelSerializer):
    """Self-service profile edit (name, phone, language, avatar)."""

    class Meta:
        model = User
        fields = ["first_name", "last_name", "phone", "preferred_language", "avatar"]


class PatientProfileSerializer(serializers.ModelSerializer):
    reliability = serializers.SerializerMethodField()

    def get_reliability(self, obj):
        from .services import patient_reliability

        return patient_reliability(obj)

    class Meta:
        model = PatientProfile
        fields = [
            "id", "national_id", "date_of_birth", "gender", "blood_type",
            "address", "emergency_contact_name", "emergency_contact_phone",
            "allergies_summary", "chronic_conditions", "previous_surgeries",
            "current_medications", "insurance_provider", "insurance_policy_number",
            "reliability",
        ]


class StaffProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = StaffProfile
        fields = ["id", "staff_id", "assigned_room"]


class NotificationPreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotificationPreference
        fields = [
            "email_enabled", "sms_enabled", "whatsapp_enabled", "in_app_enabled",
            "reminder_24h", "reminder_1h", "quiet_hours_start", "quiet_hours_end",
        ]


class RegisterSerializer(serializers.ModelSerializer):
    """Public self-registration — patients only (staff are created by a manager)."""

    password = serializers.CharField(write_only=True, validators=[validate_password])
    password_confirm = serializers.CharField(write_only=True)

    class Meta:
        model = User
        fields = [
            "email", "password", "password_confirm",
            "first_name", "last_name", "phone", "preferred_language",
        ]

    def validate(self, attrs):
        if attrs["password"] != attrs.pop("password_confirm"):
            raise serializers.ValidationError(
                {"password_confirm": "The two passwords do not match."}
            )
        return attrs

    def create(self, validated_data):
        password = validated_data.pop("password")
        # Public registration always creates a PATIENT; the signal builds the profile.
        user = User(role=RoleChoices.PATIENT, **validated_data)
        user.set_password(password)
        user.save()
        return user


class LoginSerializer(TokenObtainPairSerializer):
    """Adds the role claim and returns the user object alongside the tokens."""

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["role"] = user.role
        token["name"] = user.get_full_name()
        return token

    def validate(self, attrs):
        data = super().validate(attrs)
        data["user"] = build_user_payload(self.user)
        return data


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    new_password = serializers.CharField(validators=[validate_password])


class ChangePasswordSerializer(serializers.Serializer):
    """Authenticated self-service password change (also clears must_change_password)."""

    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, validators=[validate_password])

    def validate_current_password(self, value):
        user = self.context["request"].user
        if not user.check_password(value):
            raise serializers.ValidationError("Your current password is incorrect.")
        return value
