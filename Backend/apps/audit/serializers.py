from rest_framework import serializers

from .models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    actor_email = serializers.CharField(source="actor.email", read_only=True, default=None)
    actor_name = serializers.CharField(source="actor.get_full_name", read_only=True, default="")
    action_display = serializers.CharField(source="get_action_display", read_only=True)

    class Meta:
        model = AuditLog
        fields = [
            "id", "actor", "actor_email", "actor_name", "action", "action_display",
            "model_name", "object_id", "object_repr", "changes",
            "ip_address", "user_agent", "timestamp",
        ]
        read_only_fields = fields
