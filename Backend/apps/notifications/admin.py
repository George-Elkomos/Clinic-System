from django.contrib import admin

from .models import Notification


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ["id", "recipient", "verb", "title", "is_read", "created_at"]
    list_filter = ["verb", "is_read"]
    search_fields = ["recipient__email", "title"]
