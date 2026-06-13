from django.urls import path

from .staff_views import (
    CreateDoctorView,
    CreatePatientView,
    CreateSecretaryView,
    PatientProfileStaffView,
    UserDeactivateView,
    UserDetailView,
    UserListView,
    UserReactivateView,
    UserResetPasswordView,
)

urlpatterns = [
    # Staff creation
    path("staff/create-doctor/", CreateDoctorView.as_view(), name="staff-create-doctor"),
    path("staff/create-secretary/", CreateSecretaryView.as_view(), name="staff-create-secretary"),
    path("staff/create-patient/", CreatePatientView.as_view(), name="staff-create-patient"),
    # User management (manager)
    path("staff/users/", UserListView.as_view(), name="staff-user-list"),
    path("staff/users/<int:pk>/", UserDetailView.as_view(), name="staff-user-detail"),
    path("staff/users/<int:pk>/deactivate/", UserDeactivateView.as_view(), name="staff-user-deactivate"),
    path("staff/users/<int:pk>/reactivate/", UserReactivateView.as_view(), name="staff-user-reactivate"),
    path("staff/users/<int:pk>/reset-password/", UserResetPasswordView.as_view(), name="staff-user-reset-password"),
    # Patient profile (secretary + manager)
    path("patients/<int:pk>/profile/", PatientProfileStaffView.as_view(), name="staff-patient-profile"),
]
