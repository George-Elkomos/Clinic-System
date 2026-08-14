"""Access control for ProcedureTemplate / ClinicalProcedure.

Procedures are clinical data performed by a doctor. There is no NURSE role in
this system, so — unlike LabOrder, where secretaries handle sample-collection
logistics — SECRETARY has no access to clinical procedure records at all
(matching MedicalDataPermission's treatment of MedicalRecord/Prescription).

MANAGER is read-only on individual procedure records: only the performing
doctor may create/start/complete/cancel/edit one, since it documents an
actual clinical act the manager did not witness or perform (same principle
as EncounterPermission — administrative roles never author clinical content).
"""
from rest_framework.permissions import SAFE_METHODS, BasePermission

from apps.core.enums import RoleChoices
from apps.medical_records.permissions import doctor_treats


class ProcedureTemplatePermission(BasePermission):
    """Read: any authenticated staff. Write: DOCTOR or MANAGER only."""

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if request.method in SAFE_METHODS:
            return True
        return user.role in (RoleChoices.DOCTOR, RoleChoices.MANAGER)


class ClinicalProcedurePermission(BasePermission):
    """
    Create/transitions: DOCTOR only (own or treated patients).
    Read: PATIENT (own), DOCTOR (performing/treating), MANAGER (all).
    SECRETARY: no access.
    """

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if user.role == RoleChoices.SECRETARY:
            return False
        if request.method not in SAFE_METHODS and user.role not in (RoleChoices.DOCTOR, RoleChoices.MANAGER):
            return False
        if request.method == "POST" and view.action == "create":
            return user.role == RoleChoices.DOCTOR
        return True

    def has_object_permission(self, request, view, obj):
        user = request.user
        if user.role == RoleChoices.MANAGER:
            return request.method in SAFE_METHODS
        if user.role == RoleChoices.PATIENT:
            return request.method in SAFE_METHODS and obj.patient.user_id == user.id
        if user.role == RoleChoices.DOCTOR:
            is_performing = obj.doctor.user_id == user.id
            is_treating = doctor_treats(user, obj.patient)
            if request.method not in SAFE_METHODS:
                return is_performing
            return is_performing or is_treating
        return False
