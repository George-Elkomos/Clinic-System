from rest_framework import serializers

from .models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = [
            "id", "verb", "title", "title_ar", "body", "body_ar",
            "is_read", "read_at", "related_object_type", "related_object_id",
            "created_at",
        ]
        read_only_fields = fields
