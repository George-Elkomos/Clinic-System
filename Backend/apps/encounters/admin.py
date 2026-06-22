from django.contrib import admin

from .models import Complaint, Diagnosis, Encounter


@admin.register(Complaint)
class ComplaintAdmin(admin.ModelAdmin):
    list_display = ["name", "category", "is_active"]
    list_filter = ["category", "is_active"]
    search_fields = ["name", "name_ar"]


@admin.register(Diagnosis)
class DiagnosisAdmin(admin.ModelAdmin):
    list_display = ["name", "category", "is_active"]
    list_filter = ["category", "is_active"]
    search_fields = ["name", "name_ar"]


@admin.register(Encounter)
class EncounterAdmin(admin.ModelAdmin):
    list_display = ["id", "patient", "doctor", "status", "version", "is_current", "encounter_date"]
    list_filter = ["status", "is_current"]
    raw_id_fields = ["patient", "doctor", "appointment", "diagnosis", "vitals", "supersedes"]
