from django.contrib import admin

from .models import AllergyAlert, DosageForm, DosagePattern, Medication, MedicationClass


@admin.register(MedicationClass)
class MedicationClassAdmin(admin.ModelAdmin):
    list_display = ["name", "is_active"]
    list_filter = ["is_active"]
    search_fields = ["name", "name_ar"]
    filter_horizontal = ["interactions"]


@admin.register(DosageForm)
class DosageFormAdmin(admin.ModelAdmin):
    list_display = ["name", "is_active"]
    list_filter = ["is_active"]
    search_fields = ["name", "name_ar"]


@admin.register(DosagePattern)
class DosagePatternAdmin(admin.ModelAdmin):
    list_display = ["name", "code", "is_active"]
    list_filter = ["is_active"]
    search_fields = ["name", "name_ar", "code"]


@admin.register(Medication)
class MedicationAdmin(admin.ModelAdmin):
    list_display = ["name", "drug_class", "requires_prescription", "is_active"]
    list_filter = ["drug_class", "requires_prescription", "is_active"]
    search_fields = ["name", "name_ar"]
    raw_id_fields = ["drug_class"]
    filter_horizontal = ["dosage_forms"]


@admin.register(AllergyAlert)
class AllergyAlertAdmin(admin.ModelAdmin):
    list_display = ["allergy_keyword", "drug_class", "severity"]
    list_filter = ["severity", "drug_class"]
    search_fields = ["allergy_keyword"]
    raw_id_fields = ["drug_class"]
