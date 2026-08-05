from django.contrib import admin

from .models import RadiologyOrder, RadiologyTemplate


@admin.register(RadiologyTemplate)
class RadiologyTemplateAdmin(admin.ModelAdmin):
    list_display = ["name", "modality", "body_part", "is_active"]
    list_filter = ["modality", "is_active"]
    search_fields = ["name", "name_ar"]


@admin.register(RadiologyOrder)
class RadiologyOrderAdmin(admin.ModelAdmin):
    list_display = ["id", "accession_number", "study_name", "patient", "doctor", "status", "priority", "created_at"]
    list_filter = ["status", "priority"]
    search_fields = ["study_name", "study_name_ar", "accession_number"]
    raw_id_fields = ["patient", "doctor", "appointment", "encounter", "template"]
