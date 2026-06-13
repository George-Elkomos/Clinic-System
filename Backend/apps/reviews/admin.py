from django.contrib import admin

from .models import Review


@admin.register(Review)
class ReviewAdmin(admin.ModelAdmin):
    list_display = ["doctor", "patient", "rating", "is_hidden", "created_at"]
    list_filter = ["rating", "is_hidden"]
    search_fields = ["doctor__user__email", "patient__user__email"]
