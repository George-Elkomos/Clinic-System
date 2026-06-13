from django.contrib import admin

from .models import (
    ClinicalNote,
    LabResult,
    MedicalRecord,
    Prescription,
    PrescriptionItem,
    Scan,
)


@admin.register(MedicalRecord)
class MedicalRecordAdmin(admin.ModelAdmin):
    list_display = ["patient", "doctor", "version", "is_current", "created_at"]
    list_filter = ["is_current"]


@admin.register(ClinicalNote)
class ClinicalNoteAdmin(admin.ModelAdmin):
    list_display = ["patient", "doctor", "specialty_category", "created_at"]
    list_filter = ["specialty_category"]


@admin.register(Scan)
class ScanAdmin(admin.ModelAdmin):
    list_display = ["patient", "category", "uploaded_by", "created_at"]
    list_filter = ["category"]


@admin.register(LabResult)
class LabResultAdmin(admin.ModelAdmin):
    list_display = ["patient", "test_name", "category", "is_abnormal"]
    list_filter = ["category", "is_abnormal"]


class PrescriptionItemInline(admin.TabularInline):
    model = PrescriptionItem
    extra = 0


@admin.register(Prescription)
class PrescriptionAdmin(admin.ModelAdmin):
    list_display = ["patient", "doctor", "issued_date", "status"]
    list_filter = ["status"]
    inlines = [PrescriptionItemInline]
