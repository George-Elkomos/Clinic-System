from django.conf import settings
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from apps.core.enums import RoleChoices
from apps.medical_records.permissions import doctor_treats

from .models import SessionRecording, SessionStatus
from .permissions import AIScribePermission
from .serializers import CommitSerializer, SessionSerializer, SessionUploadSerializer
from .services import pipeline
from .services.commit import commit_draft


class SessionRecordingViewSet(viewsets.ModelViewSet):
    """AI Scribe lifecycle.

    POST   /api/ai/sessions/            upload audio -> kicks off processing
    GET    /api/ai/sessions/{id}/       poll status / read transcript + draft
    GET    /api/ai/sessions/?patient=   list a patient's sessions
    POST   /api/ai/sessions/{id}/commit/   write the reviewed draft to records
    DELETE /api/ai/sessions/{id}/       soft-delete a session
    """

    permission_classes = [AIScribePermission]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    http_method_names = ["get", "post", "delete", "head", "options"]
    filterset_fields = ["patient", "status"]

    def get_queryset(self):
        user = self.request.user
        qs = SessionRecording.objects.select_related(
            "patient__user", "doctor__user"
        ).order_by("-created_at")
        if user.role == RoleChoices.MANAGER:
            return qs
        if user.role == RoleChoices.DOCTOR:
            return qs.filter(patient__treating_doctors__doctor__user=user).distinct()
        return qs.none()

    def get_serializer_class(self):
        return SessionUploadSerializer if self.action == "create" else SessionSerializer

    def create(self, request, *args, **kwargs):
        if not settings.AI_SCRIBE_ENABLED:
            return Response(
                {"detail": "AI Scribe is disabled on this server."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        patient = serializer.validated_data["patient"]
        if not doctor_treats(request.user, patient):
            raise PermissionDenied("You can only record sessions for your own patients.")

        audio = serializer.validated_data["audio"]
        session = serializer.save(
            doctor=request.user.doctor_profile,
            original_filename=getattr(audio, "name", "")[:255],
            content_type=getattr(audio, "content_type", "") or "",
            file_size=getattr(audio, "size", 0) or 0,
        )
        # Transcribe + extract off the request thread; the client polls status.
        pipeline.process_in_background(session.pk)
        return Response(SessionSerializer(session).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def commit(self, request, pk=None):
        session = self.get_object()  # enforces object-level permission
        if request.user.role != RoleChoices.DOCTOR:
            raise PermissionDenied("Only a doctor can commit a session into records.")
        if session.status == SessionStatus.COMMITTED:
            raise ValidationError({"detail": "This session was already committed."})
        if session.status != SessionStatus.READY:
            raise ValidationError(
                {"detail": f"Session is not ready to commit (status: {session.status})."}
            )
        serializer = CommitSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        session = commit_draft(
            session,
            serializer.validated_data["draft"],
            doctor=request.user.doctor_profile,
            create_prescription=serializer.validated_data["create_prescription"],
        )
        return Response(SessionSerializer(session).data)

    @action(detail=True, methods=["post"])
    def retry(self, request, pk=None):
        """Re-run transcription + extraction (e.g. after a transient failure)."""
        session = self.get_object()
        if session.status == SessionStatus.COMMITTED:
            raise ValidationError({"detail": "Committed sessions cannot be reprocessed."})
        session.status = SessionStatus.PENDING
        session.error = ""
        session.save(update_fields=["status", "error", "updated_at"])
        pipeline.process_in_background(session.pk)
        return Response(SessionSerializer(session).data)

    def destroy(self, request, *args, **kwargs):
        session = self.get_object()
        session.soft_delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
