from rest_framework import serializers

from apps.doctors.serializers import SpecialtySerializer

from .models import Referral


class ReferralReadSerializer(serializers.ModelSerializer):
    patient_name = serializers.CharField(source="patient.user.get_full_name", read_only=True, default="")
    referring_doctor_name = serializers.CharField(
        source="referring_doctor.user.get_full_name", read_only=True, default=""
    )
    target_doctor_name = serializers.CharField(
        source="target_doctor.user.get_full_name", read_only=True, default=""
    )
    accepted_by_name = serializers.CharField(
        source="accepted_by.user.get_full_name", read_only=True, default=""
    )
    specialty_detail = SpecialtySerializer(source="specialty", read_only=True)

    class Meta:
        model = Referral
        fields = [
            "id", "patient", "patient_name", "referring_doctor", "referring_doctor_name",
            "encounter", "referral_type", "specialty", "specialty_detail",
            "target_doctor", "target_doctor_name", "external_facility_name",
            "accepted_by", "accepted_by_name", "reason", "reason_ar", "notes", "notes_ar",
            "referral_date", "status", "created_at",
        ]


class ReferralLimitedSerializer(ReferralReadSerializer):
    """Secretary view: enough to chase up scheduling, no clinical text.

    Drops reason/reason_ar/notes/notes_ar — those are the doctor's clinical
    rationale, same sensitivity level as encounter notes, which secretaries
    can't see either.
    """

    class Meta(ReferralReadSerializer.Meta):
        fields = [f for f in ReferralReadSerializer.Meta.fields if f not in (
            "reason", "reason_ar", "notes", "notes_ar",
        )]


class ReferralCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Referral
        fields = [
            "encounter", "referral_type", "specialty", "target_doctor",
            "external_facility_name", "reason", "reason_ar", "notes", "notes_ar",
        ]

    def validate(self, attrs):
        referral_type = attrs.get("referral_type")
        specialty = attrs.get("specialty")
        target_doctor = attrs.get("target_doctor")
        facility_name = attrs.get("external_facility_name", "")

        if referral_type == "INTERNAL":
            if not specialty:
                raise serializers.ValidationError(
                    {"specialty": "A specialty is required for an internal referral."}
                )
            if facility_name:
                raise serializers.ValidationError(
                    {"external_facility_name": "External facility name isn't used for internal referrals."}
                )
            if target_doctor and not target_doctor.specialties.filter(pk=specialty.pk).exists():
                raise serializers.ValidationError(
                    {"target_doctor": "The chosen doctor doesn't belong to the selected specialty."}
                )
        elif referral_type == "EXTERNAL":
            if not facility_name:
                raise serializers.ValidationError(
                    {"external_facility_name": "A facility name is required for an external referral."}
                )
            if specialty or target_doctor:
                raise serializers.ValidationError(
                    {"specialty": "Specialty/doctor aren't used for external referrals."}
                )
        return attrs
