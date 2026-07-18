from django.contrib import admin

from .models import Referral


@admin.register(Referral)
class ReferralAdmin(admin.ModelAdmin):
    list_display = [
        "id", "patient", "referring_doctor", "referral_type", "specialty",
        "target_doctor", "status", "referral_date",
    ]
    list_filter = ["status", "referral_type", "referral_date"]
    search_fields = [
        "patient__user__first_name", "patient__user__last_name",
        "external_facility_name", "reason",
    ]
    raw_id_fields = ["patient", "referring_doctor", "encounter", "target_doctor", "accepted_by"]
