from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from apps.core.enums import RoleChoices

from .models import NotificationPreference, PatientProfile, User


class UserSerializer(serializers.ModelSerializer):
    full_name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id", "email", "role", "first_name", "last_name", "full_name",
            "phone", "preferred_language", "is_active", "date_joined",
        ]
        read_only_fields = ["id", "role", "is_active", "date_joined"]

    def get_full_name(self, obj):
        return obj.get_full_name()


class MeUpdateSerializer(serializers.ModelSerializer):
    """Self-service profile edit (name, phone, language)."""

    class Meta:
        model = User
        fields = ["first_name", "last_name", "phone", "preferred_language"]


class PatientProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = PatientProfile
        fields = [
            "id", "national_id", "date_of_birth", "gender", "blood_type",
            "address", "emergency_contact_name", "emergency_contact_phone",
            "allergies_summary", "chronic_conditions", "previous_surgeries",
            "current_medications",
        ]


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
        data["user"] = UserSerializer(self.user).data
        return data


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    new_password = serializers.CharField(validators=[validate_password])
