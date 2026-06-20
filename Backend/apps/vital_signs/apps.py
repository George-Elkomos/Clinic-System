from django.apps import AppConfig


class VitalSignsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.vital_signs"
    verbose_name = "Vital Signs"

    def ready(self):
        import apps.vital_signs.signals  # noqa: F401 — registers post_save signal
