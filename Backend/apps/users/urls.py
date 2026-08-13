from django.urls import path

from .views import (
    ChangePasswordView,
    CookieTokenRefreshView,
    LoginView,
    LogoutView,
    MeView,
    NotificationPreferenceView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    PatientProfileView,
    RegisterView,
    StaffProfileView,
)

# Mounted under /api/auth/
urlpatterns = [
    path("login/", LoginView.as_view(), name="auth-login"),
    path("refresh/", CookieTokenRefreshView.as_view(), name="auth-refresh"),
    path("logout/", LogoutView.as_view(), name="auth-logout"),
    path("register/", RegisterView.as_view(), name="auth-register"),
    path("me/", MeView.as_view(), name="auth-me"),
    path("me/change-password/", ChangePasswordView.as_view(), name="auth-change-password"),
    path("me/patient-profile/", PatientProfileView.as_view(), name="auth-patient-profile"),
    path("me/staff-profile/", StaffProfileView.as_view(), name="auth-staff-profile"),
    path("me/notification-preference/", NotificationPreferenceView.as_view(), name="auth-notif-pref"),
    path("password-reset/", PasswordResetRequestView.as_view(), name="auth-password-reset"),
    path("password-reset/confirm/", PasswordResetConfirmView.as_view(), name="auth-password-reset-confirm"),
]
