# Financial roadmap Task 16 — registers the revenue-integrity check as a
# recurring django-q Schedule, the same convention as
# apps/appointments/migrations/0005_schedule_expiry_sweep.py.
#
# Depends explicitly on billing's latest migration (0012), not just
# accounting's own history. Without that, Django's migration executor is
# free to apply this migration (which makes the Schedule row exist) before
# billing 0009-0012 finish applying in the same `manage.py migrate` run.
# deploy.sh already only restarts clinic-qcluster *after* `migrate` fully
# succeeds, so the new code is never running against a partially-migrated
# schema in practice — but the *old*, still-running qcluster process stays
# alive throughout the migrate call itself, and django-q resolves a
# Schedule's task function dynamically at execution time. Depending on
# billing/0012 here closes that window at the migration-graph level too: the
# Schedule row cannot exist in the database until the entire Finance schema
# (accounting 0001-0003 and billing 0009-0012) is already in place, no
# matter what order Django would otherwise have chosen or how the deploy
# script's process timing happens to line up.
#
# Not circular: billing/0011 already depends on accounting/0003 (posting
# needs the ledger to exist first); this migration extends that same chain
# one step further (accounting/0003 -> billing/0011 -> billing/0012 ->
# accounting/0004) without revisiting any node.
#
# Also depends on django_q's latest migration (0019), matching
# 0005_schedule_expiry_sweep's own convention — required so the historical
# migration state handed to RunPython actually has the django_q app loaded;
# without it `apps.get_model("django_q", "Schedule")` raises LookupError
# when the whole graph is replayed from scratch (e.g. building a test DB).
from django.db import migrations

SCHEDULE_FUNC = "apps.accounting.tasks.run_revenue_integrity_check"


def create_schedule(apps, schema_editor):
    Schedule = apps.get_model("django_q", "Schedule")
    if Schedule.objects.filter(func=SCHEDULE_FUNC).exists():
        return
    Schedule.objects.create(
        name="Finance revenue-integrity check",
        func=SCHEDULE_FUNC,
        schedule_type="I",  # django_q.models.Schedule.MINUTES
        minutes=60,
        repeats=-1,
    )


def remove_schedule(apps, schema_editor):
    Schedule = apps.get_model("django_q", "Schedule")
    Schedule.objects.filter(func=SCHEDULE_FUNC).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("accounting", "0003_journal_immutability_trigger"),
        ("billing", "0012_idempotent_requests"),
        ("django_q", "0019_alter_task_options_alter_ormq_key_alter_ormq_lock_and_more"),
    ]

    operations = [
        migrations.RunPython(create_schedule, remove_schedule),
    ]
