from django.urls import path

from .views import (
    CookieTokenRefreshView,
    LoginView,
    LogoutView,
    MeView,
    NotificationPreferenceView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    PatientProfileView,
    RegisterView,
)

# Mounted under /api/auth/
urlpatterns = [
    path("login/", LoginView.as_view(), name="auth-login"),
    path("refresh/", CookieTokenRefreshView.as_view(), name="auth-refresh"),
    path("logout/", LogoutView.as_view(), name="auth-logout"),
    path("register/", RegisterView.as_view(), name="auth-register"),
    path("me/", MeView.as_view(), name="auth-me"),
    path("me/patient-profile/", PatientProfileView.as_view(), name="auth-patient-profile"),
    path("me/notification-preference/", NotificationPreferenceView.as_view(), name="auth-notif-pref"),
    path("password-reset/", PasswordResetRequestView.as_view(), name="auth-password-reset"),
    path("password-reset/confirm/", PasswordResetConfirmView.as_view(), name="auth-password-reset-confirm"),
]
