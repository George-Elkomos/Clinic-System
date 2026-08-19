from django.db import migrations


def copy_full_name_ar_to_user(apps, schema_editor):
    DoctorProfile = apps.get_model("doctors", "DoctorProfile")
    for profile in DoctorProfile.objects.select_related("user").exclude(full_name_ar=""):
        user = profile.user
        if not user.name_ar:
            user.name_ar = profile.full_name_ar
            user.save(update_fields=["name_ar"])


def noop_reverse(apps, schema_editor):
    """Not reversible: User.name_ar may since have been edited directly, and
    DoctorProfile.full_name_ar no longer exists once 0005 runs."""


class Migration(migrations.Migration):

    dependencies = [
        ("doctors", "0003_doctorprofile_full_name_ar"),
        ("users", "0007_user_name_ar_name_en"),
    ]

    operations = [
        migrations.RunPython(copy_full_name_ar_to_user, noop_reverse),
    ]
