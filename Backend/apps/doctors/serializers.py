from rest_framework import serializers

from apps.users.models import User

from .models import (
    DoctorAbsence,
    DoctorProfile,
    Specialty,
    SpecialtyCategory,
    TimeSlot,
    WorkingSchedule,
)


class SpecialtyCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = SpecialtyCategory
        fields = ["id", "name", "name_ar", "is_active"]


class SpecialtySerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True)

    class Meta:
        model = Specialty
        fields = ["id", "name", "name_ar", "category", "category_name", "description", "is_active"]


class DoctorProfileSerializer(serializers.ModelSerializer):
    """Full read representation used across staff + patient booking screens."""

    full_name = serializers.CharField(source="user.get_full_name", read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)
    phone = serializers.CharField(source="user.phone", read_only=True)
    specialties_detail = SpecialtySerializer(source="specialties", many=True, read_only=True)
    photo = serializers.ImageField(read_only=True)

    class Meta:
        model = DoctorProfile
        fields = [
            "id", "full_name", "email", "phone",
            "license_number", "bio", "bio_ar", "education", "languages_spoken",
            "years_experience", "consultation_fee", "avg_appointment_duration",
            "room_number", "photo", "accepts_walk_ins", "is_accepting_patients",
            "specialties", "specialties_detail",
        ]
        read_only_fields = ["id"]


class DoctorProfileWriteSerializer(serializers.ModelSerializer):
    """Doctor self-edit / secretary edit (no license edits by the doctor)."""

    class Meta:
        model = DoctorProfile
        fields = [
            "bio", "bio_ar", "education", "languages_spoken", "years_experience",
            "consultation_fee", "avg_appointment_duration", "room_number",
            "photo", "accepts_walk_ins", "is_accepting_patients", "specialties",
        ]


class PublicDoctorSerializer(serializers.ModelSerializer):
    """No-login doctor card: identity + specialty + aggregate rating + availability."""

    full_name = serializers.CharField(source="user.get_full_name", read_only=True)
    specialties_detail = SpecialtySerializer(source="specialties", many=True, read_only=True)
    average_rating = serializers.SerializerMethodField()
    review_count = serializers.SerializerMethodField()
    next_available_date = serializers.SerializerMethodField()

    class Meta:
        model = DoctorProfile
        fields = [
            "id", "full_name", "bio", "bio_ar", "photo", "room_number",
            "years_experience", "languages_spoken", "avg_appointment_duration",
            "accepts_walk_ins", "is_accepting_patients",
            "specialties_detail", "average_rating", "review_count", "next_available_date",
        ]

    def get_average_rating(self, obj):
        return getattr(obj, "average_rating", None)

    def get_review_count(self, obj):
        return getattr(obj, "review_count", 0)

    def get_next_available_date(self, obj):
        from django.utils import timezone

        from apps.core.enums import SlotStatus

        result = (
            obj.time_slots.filter(
                status=SlotStatus.AVAILABLE,
                start_datetime__gte=timezone.now(),
            )
            .order_by("start_datetime")
            .values("date")
            .first()
        )
        return str(result["date"]) if result else None

    def get_review_count(self, obj):
        return getattr(obj, "review_count", 0)


class WorkingScheduleSerializer(serializers.ModelSerializer):
    weekday_display = serializers.CharField(source="get_weekday_display", read_only=True)

    class Meta:
        model = WorkingSchedule
        fields = [
            "id", "doctor", "weekday", "weekday_display", "start_time", "end_time",
            "slot_duration", "break_start", "break_end", "valid_from", "valid_until",
            "is_active",
        ]

    def validate(self, attrs):
        start = attrs.get("start_time") or getattr(self.instance, "start_time", None)
        end = attrs.get("end_time") or getattr(self.instance, "end_time", None)
        if start and end and start >= end:
            raise serializers.ValidationError(
                {"end_time": "End time must be after start time."}
            )
        return attrs


class TimeSlotSerializer(serializers.ModelSerializer):
    class Meta:
        model = TimeSlot
        fields = ["id", "doctor", "date", "start_datetime", "end_datetime", "status", "is_walk_in_reserved"]
        read_only_fields = fields


class DoctorAbsenceSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source="created_by.get_full_name", read_only=True)

    class Meta:
        model = DoctorAbsence
        fields = [
            "id", "doctor", "start_date", "end_date", "reason", "absence_type",
            "notify_patients", "created_by", "created_by_name", "created_at",
        ]
        read_only_fields = ["id", "created_by", "created_by_name", "created_at"]

    def validate(self, attrs):
        start = attrs.get("start_date") or getattr(self.instance, "start_date", None)
        end = attrs.get("end_date") or getattr(self.instance, "end_date", None)
        if start and end and start > end:
            raise serializers.ValidationError(
                {"end_date": "End date cannot be before the start date."}
            )
        return attrs
