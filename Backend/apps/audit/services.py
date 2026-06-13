"""Helpers to write audit rows. Auditing must never break the audited action,
so all writes are best-effort (failures are logged, not raised)."""
import logging

from apps.core.middleware import get_current_request_meta, get_current_user

from .models import AuditLog

logger = logging.getLogger(__name__)


def record_event(*, action, actor=None, instance=None, changes=None, request=None):
    try:
        actor = actor or get_current_user()
        meta = get_current_request_meta()
        ip = meta.get("ip_address")
        ua = meta.get("user_agent", "")
        if request is not None:
            ip = ip or request.META.get("REMOTE_ADDR")
            ua = ua or request.META.get("HTTP_USER_AGENT", "")[:512]

        AuditLog.objects.create(
            actor=actor if (actor and getattr(actor, "pk", None)) else None,
            action=action,
            model_name=instance.__class__.__name__ if instance is not None else "",
            object_id=str(instance.pk) if instance is not None and instance.pk else "",
            object_repr=str(instance)[:200] if instance is not None else "",
            changes=changes or {},
            ip_address=ip,
            user_agent=ua or "",
        )
    except Exception:  # pragma: no cover - auditing is best-effort
        logger.exception("Failed to write audit log entry")
