from django.apps import AppConfig
from django.db.backends.signals import connection_created
from django.dispatch import receiver


class CoreConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.core"


@receiver(connection_created)
def configure_sqlite(sender, connection, **kwargs):
    """Enable WAL + sane pragmas on SQLite so the notification/audit signal
    fan-out and the 30s kiosk polling don't trip 'database is locked'."""
    if connection.vendor == "sqlite":
        cursor = connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL;")
        cursor.execute("PRAGMA synchronous=NORMAL;")
        cursor.execute("PRAGMA foreign_keys=ON;")
        cursor.execute("PRAGMA busy_timeout=20000;")
