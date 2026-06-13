from rest_framework import mixins, viewsets

from apps.users.permissions import IsManager

from .models import AuditLog
from .serializers import AuditLogSerializer


class AuditLogViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin,
                      viewsets.GenericViewSet):
    """Manager-only, read-only, searchable change ledger (module 12)."""

    queryset = AuditLog.objects.select_related("actor").all()
    serializer_class = AuditLogSerializer
    permission_classes = [IsManager]
    filterset_fields = ["actor", "action", "model_name"]
    search_fields = ["object_repr", "object_id", "actor__email"]
    ordering_fields = ["timestamp"]
