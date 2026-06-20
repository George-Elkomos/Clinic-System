from django.contrib import admin

from .models import VitalSigns


@admin.register(VitalSigns)
class VitalSignsAdmin(admin.ModelAdmin):
    list_display = [
        "patient",
        "recorded_by",
        "bp_systolic",
        "bp_diastolic",
        "heart_rate",
        "temperature",
        "oxygen_saturation",
        "created_at",
    ]
    list_filter = ["created_at"]
    search_fields = ["patient__user__first_name", "patient__user__last_name", "patient__user__email"]
    readonly_fields = ["created_at", "updated_at", "deleted_at"]
