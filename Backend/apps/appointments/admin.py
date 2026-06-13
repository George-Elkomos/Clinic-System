from django.contrib import admin

from .models import Appointment, FollowUp, WaitlistEntry


@admin.register(Appointment)
class AppointmentAdmin(admin.ModelAdmin):
    list_display = ["id", "patient", "doctor", "scheduled_start", "status", "appointment_type"]
    list_filter = ["status", "appointment_type", "doctor"]
    search_fields = ["patient__user__email", "doctor__user__email"]
    date_hierarchy = "scheduled_start"


@admin.register(WaitlistEntry)
class WaitlistEntryAdmin(admin.ModelAdmin):
    list_display = ["patient", "doctor", "desired_date_from", "desired_date_to", "status"]
    list_filter = ["status", "doctor"]


@admin.register(FollowUp)
class FollowUpAdmin(admin.ModelAdmin):
    list_display = ["patient", "doctor", "recommended_date", "status"]
    list_filter = ["status"]
