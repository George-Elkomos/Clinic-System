from django.db import migrations

SCHEDULE_FUNC = "apps.appointments.tasks.run_expiry_sweep"


def create_schedule(apps, schema_editor):
    Schedule = apps.get_model("django_q", "Schedule")
    if Schedule.objects.filter(func=SCHEDULE_FUNC).exists():
        return
    Schedule.objects.create(
        name="Appointment auto-expiry sweep",
        func=SCHEDULE_FUNC,
        schedule_type="I",  # django_q.models.Schedule.MINUTES
        minutes=5,
        repeats=-1,
    )


def remove_schedule(apps, schema_editor):
    Schedule = apps.get_model("django_q", "Schedule")
    Schedule.objects.filter(func=SCHEDULE_FUNC).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("appointments", "0004_alter_appointment_status"),
        ("django_q", "0019_alter_task_options_alter_ormq_key_alter_ormq_lock_and_more"),
    ]

    operations = [
        migrations.RunPython(create_schedule, remove_schedule),
    ]
