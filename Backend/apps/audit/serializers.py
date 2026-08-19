from rest_framework import serializers

from apps.core.i18n import get_request_locale, localized_name

from .models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    actor_email = serializers.CharField(source="actor.email", read_only=True, default=None)
    actor_name = serializers.SerializerMethodField()
    action_display = serializers.CharField(source="get_action_display", read_only=True)

    def get_actor_name(self, obj):
        locale = get_request_locale(self.context.get("request"))
        return localized_name(obj.actor, locale) or ""

    class Meta:
        model = AuditLog
        fields = [
            "id", "actor", "actor_email", "actor_name", "action", "action_display",
            "model_name", "object_id", "object_repr", "changes",
            "ip_address", "user_agent", "timestamp",
        ]
        read_only_fields = fields
