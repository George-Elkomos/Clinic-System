from django.contrib import admin

from .models import ClinicalProcedure, ProcedureTemplate


@admin.register(ProcedureTemplate)
class ProcedureTemplateAdmin(admin.ModelAdmin):
    list_display = ["name", "category", "estimated_duration_minutes", "is_active"]
    list_filter = ["category", "is_active"]
    search_fields = ["name", "name_ar"]


@admin.register(ClinicalProcedure)
class ClinicalProcedureAdmin(admin.ModelAdmin):
    list_display = ["id", "procedure_name", "patient", "doctor", "status", "created_at"]
    list_filter = ["status"]
    search_fields = ["procedure_name", "procedure_name_ar"]
    raw_id_fields = ["patient", "doctor", "appointment", "encounter", "template"]
