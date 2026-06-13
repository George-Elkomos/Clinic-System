from django.conf import settings
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from rest_framework import generics, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from apps.core.enums import AuditAction

from .models import NotificationPreference, PatientProfile, User
from .serializers import (
    LoginSerializer,
    MeUpdateSerializer,
    NotificationPreferenceSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    PatientProfileSerializer,
    RegisterSerializer,
    UserSerializer,
)

COOKIE_NAME = settings.JWT_REFRESH_COOKIE


def _set_refresh_cookie(response, refresh_token):
    response.set_cookie(
        key=COOKIE_NAME,
        value=str(refresh_token),
        max_age=int(settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"].total_seconds()),
        httponly=True,
        secure=settings.JWT_COOKIE_SECURE,
        samesite=settings.JWT_COOKIE_SAMESITE,
        path=settings.JWT_COOKIE_PATH,
    )


def _delete_refresh_cookie(response):
    response.delete_cookie(COOKIE_NAME, path=settings.JWT_COOKIE_PATH)


def _audit_auth(user, action, request):
    """Record LOGIN/LOGOUT (non-model events) in the audit log."""
    try:
        from apps.audit.services import record_event

        record_event(actor=user, action=action, instance=user, request=request)
    except Exception:  # never let auditing break authentication
        pass


class LoginView(TokenObtainPairView):
    """Returns the access token in the body; refresh token in an httpOnly cookie."""

    permission_classes = [AllowAny]
    serializer_class = LoginSerializer

    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        refresh = response.data.pop("refresh", None)
        if refresh:
            _set_refresh_cookie(response, refresh)
        email = request.data.get("email")
        if email:
            _audit_auth(User.objects.filter(email=email).first(), AuditAction.LOGIN, request)
        return response


class CookieTokenRefreshView(TokenRefreshView):
    """Reads the refresh token from the httpOnly cookie (not the body)."""

    permission_classes = [AllowAny]

    def post(self, request, *args, **kwargs):
        refresh = request.COOKIES.get(COOKIE_NAME)
        if not refresh:
            return Response(
                {"detail": "Your session has expired. Please sign in again.",
                 "code": "no_refresh_cookie"},
                status=status.HTTP_401_UNAUTHORIZED,
            )
        serializer = self.get_serializer(data={"refresh": refresh})
        serializer.is_valid(raise_exception=True)  # InvalidToken -> 401
        validated = serializer.validated_data
        response = Response({"access": validated["access"]})
        rotated = validated.get("refresh")  # ROTATE_REFRESH_TOKENS is on
        if rotated:
            _set_refresh_cookie(response, rotated)
        return response


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        refresh = request.COOKIES.get(COOKIE_NAME)
        if refresh:
            try:
                RefreshToken(refresh).blacklist()
            except TokenError:
                pass
        _audit_auth(request.user, AuditAction.LOGOUT, request)
        response = Response(status=status.HTTP_205_RESET_CONTENT)
        _delete_refresh_cookie(response)
        return response


class MeView(APIView):
    """Current user with nested patient profile + notification preferences."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(self._payload(request.user))

    def patch(self, request):
        serializer = MeUpdateSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(self._payload(request.user))

    @staticmethod
    def _payload(user):
        data = UserSerializer(user).data
        profile = getattr(user, "patient_profile", None)
        data["patient_profile"] = (
            PatientProfileSerializer(profile).data if profile else None
        )
        prefs = getattr(user, "notification_preference", None)
        data["notification_preference"] = (
            NotificationPreferenceSerializer(prefs).data if prefs else None
        )
        # Doctors get their profile (incl. specialties → categories for note tagging).
        doctor_profile = getattr(user, "doctor_profile", None)
        if doctor_profile is not None:
            from apps.doctors.serializers import DoctorProfileSerializer

            data["doctor_profile"] = DoctorProfileSerializer(doctor_profile).data
        return data


class RegisterView(generics.CreateAPIView):
    permission_classes = [AllowAny]
    serializer_class = RegisterSerializer
    queryset = User.objects.all()

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)


class PatientProfileView(generics.RetrieveUpdateAPIView):
    """A patient reads/updates their own profile."""

    permission_classes = [IsAuthenticated]
    serializer_class = PatientProfileSerializer

    def get_object(self):
        profile, _ = PatientProfile.objects.get_or_create(user=self.request.user)
        return profile


class NotificationPreferenceView(generics.RetrieveUpdateAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = NotificationPreferenceSerializer

    def get_object(self):
        prefs, _ = NotificationPreference.objects.get_or_create(user=self.request.user)
        return prefs


class PasswordResetRequestView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = User.objects.filter(email=serializer.validated_data["email"]).first()
        if user:
            uid = urlsafe_base64_encode(force_bytes(user.pk))
            token = default_token_generator.make_token(user)
            # Frontend route handles the actual form; link is emailed (console in dev).
            reset_link = f"/reset-password?uid={uid}&token={token}"
            send_mail(
                subject="Reset your clinic account password",
                message=f"Open this link to choose a new password: {reset_link}",
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[user.email],
                fail_silently=True,
            )
        # Always 200 — don't reveal whether an email is registered.
        return Response(
            {"detail": "If that email exists, a reset link has been sent."}
        )


class PasswordResetConfirmView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            uid = force_str(urlsafe_base64_decode(data["uid"]))
            user = User.objects.get(pk=uid)
        except (User.DoesNotExist, ValueError, TypeError, OverflowError):
            return Response(
                {"detail": "This reset link is invalid.", "code": "invalid_link"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not default_token_generator.check_token(user, data["token"]):
            return Response(
                {"detail": "This reset link has expired. Please request a new one.",
                 "code": "expired_link"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user.set_password(data["new_password"])
        user.save(update_fields=["password"])
        return Response({"detail": "Your password has been updated. You can sign in now."})
