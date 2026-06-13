from django.contrib import admin

from .models import (
    DoctorAbsence,
    DoctorPatient,
    DoctorProfile,
    Specialty,
    SpecialtyCategory,
    TimeSlot,
    WorkingSchedule,
)


@admin.register(SpecialtyCategory)
class SpecialtyCategoryAdmin(admin.ModelAdmin):
    list_display = ["name", "name_ar", "is_active"]


@admin.register(Specialty)
class SpecialtyAdmin(admin.ModelAdmin):
    list_display = ["name", "category", "is_active"]
    list_filter = ["category", "is_active"]


@admin.register(DoctorProfile)
class DoctorProfileAdmin(admin.ModelAdmin):
    list_display = ["user", "license_number", "years_experience", "is_accepting_patients"]
    search_fields = ["user__email", "user__first_name", "user__last_name", "license_number"]
    filter_horizontal = ["specialties"]


@admin.register(WorkingSchedule)
class WorkingScheduleAdmin(admin.ModelAdmin):
    list_display = ["doctor", "weekday", "start_time", "end_time", "is_active"]
    list_filter = ["weekday", "is_active"]


@admin.register(TimeSlot)
class TimeSlotAdmin(admin.ModelAdmin):
    list_display = ["doctor", "start_datetime", "end_datetime", "status"]
    list_filter = ["status", "date"]
    date_hierarchy = "date"


@admin.register(DoctorAbsence)
class DoctorAbsenceAdmin(admin.ModelAdmin):
    list_display = ["doctor", "start_date", "end_date", "absence_type"]
    list_filter = ["absence_type"]


@admin.register(DoctorPatient)
class DoctorPatientAdmin(admin.ModelAdmin):
    list_display = ["doctor", "patient", "source", "last_treated_at"]
