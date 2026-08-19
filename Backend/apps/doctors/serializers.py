from rest_framework import serializers

from apps.core.enums import RoleChoices
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
    """`category` is optional on write: quick-add flows (e.g. the manager's
    Add Doctor form) create a bare specialty by name only, so an uncategorized
    one falls into a catch-all "General" category rather than failing."""

    category_name = serializers.CharField(source="category.name", read_only=True)

    class Meta:
        model = Specialty
        fields = ["id", "name", "name_ar", "category", "category_name", "description", "is_active"]
        extra_kwargs = {"category": {"required": False}}

    def create(self, validated_data):
        if not validated_data.get("category"):
            validated_data["category"], _ = SpecialtyCategory.objects.get_or_create(
                name="General", defaults={"name_ar": "عام"}
            )
        return super().create(validated_data)


class DoctorProfileSerializer(serializers.ModelSerializer):
    """Full read representation used across staff + patient booking screens."""

    full_name = serializers.CharField(source="user.get_full_name", read_only=True)
    name_ar = serializers.CharField(source="user.name_ar", read_only=True)
    name_en = serializers.CharField(source="user.name_en", read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)
    phone = serializers.CharField(source="user.phone", read_only=True)
    specialties_detail = SpecialtySerializer(source="specialties", many=True, read_only=True)
    photo = serializers.ImageField(read_only=True)

    class Meta:
        model = DoctorProfile
        fields = [
            "id", "full_name", "name_ar", "name_en", "email", "phone",
            "license_number", "bio", "bio_ar", "education", "languages_spoken",
            "years_experience", "consultation_fee", "avg_appointment_duration",
            "room_number", "photo", "accepts_walk_ins", "is_accepting_patients",
            "specialties", "specialties_detail",
        ]
        read_only_fields = ["id"]


class DoctorProfileWriteSerializer(serializers.ModelSerializer):
    """Doctor self-edit / secretary / manager edit — one shared endpoint, but
    not every field is writable by every role:

    - consultation_fee / room_number: Manager-exclusive (financial/space admin).
    - photo: doctor-exclusive (only the doctor editing their own profile).

    Fields outside a caller's authority are made read-only rather than
    rejecting the request, so a shared save payload from a less-privileged
    caller simply leaves them unchanged.
    """

    # These live on `user`, not `DoctorProfile` — declared plain (no `source=`)
    # so DRF hands them back flat in validated_data instead of nesting them
    # under a "user" key, and written through manually in update() below.
    name_ar = serializers.CharField(required=False, allow_blank=True)
    name_en = serializers.CharField(required=False, allow_blank=True)

    class Meta:
        model = DoctorProfile
        fields = [
            "bio", "bio_ar", "name_ar", "name_en", "education", "languages_spoken",
            "years_experience", "consultation_fee", "avg_appointment_duration",
            "room_number", "photo", "accepts_walk_ins", "is_accepting_patients",
            "specialties",
        ]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        user = getattr(self.context.get("request"), "user", None)
        if user is None:
            return
        if user.role != RoleChoices.MANAGER:
            self.fields["consultation_fee"].read_only = True
            self.fields["room_number"].read_only = True
        if not (self.instance and self.instance.user_id == user.id):
            self.fields["photo"].read_only = True

    def update(self, instance, validated_data):
        name_ar = validated_data.pop("name_ar", None)
        name_en = validated_data.pop("name_en", None)
        if name_ar is not None or name_en is not None:
            user = instance.user
            if name_ar is not None:
                user.name_ar = name_ar
            if name_en is not None:
                user.name_en = name_en
            user.save()
        old_duration = instance.avg_appointment_duration
        doctor = super().update(instance, validated_data)
        if doctor.avg_appointment_duration != old_duration:
            # Slot length always follows this setting (see
            # WorkingSchedule.effective_slot_duration) — resync now so
            # already-open slots don't keep showing the old cadence.
            from datetime import timedelta

            from django.conf import settings
            from django.utils import timezone

            from .services.slot_generator import clear_unbooked_slots, generate_slots_for_doctor

            clear_unbooked_slots(doctor=doctor)
            today = timezone.localdate()
            generate_slots_for_doctor(doctor, today, today + timedelta(days=settings.SLOT_HORIZON_DAYS))
        return doctor


class PublicDoctorSerializer(serializers.ModelSerializer):
    """No-login doctor card: identity + specialty + aggregate rating + availability."""

    full_name = serializers.CharField(source="user.get_full_name", read_only=True)
    name_ar = serializers.CharField(source="user.name_ar", read_only=True)
    name_en = serializers.CharField(source="user.name_en", read_only=True)
    specialties_detail = SpecialtySerializer(source="specialties", many=True, read_only=True)
    average_rating = serializers.SerializerMethodField()
    review_count = serializers.SerializerMethodField()
    next_available_date = serializers.SerializerMethodField()

    class Meta:
        model = DoctorProfile
        fields = [
            "id", "full_name", "name_ar", "name_en", "bio", "bio_ar", "photo", "room_number",
            "years_experience", "languages_spoken", "avg_appointment_duration",
            "consultation_fee", "accepts_walk_ins", "is_accepting_patients",
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
