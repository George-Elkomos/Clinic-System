# Financial roadmap Task 15 — the real schema change: write-offs, their
# reversal, the net write-off amount on Invoice, and frozen approval-role
# snapshots on the pre-existing correction models.
#
# Kept separate from 0014 (which only alters IdempotentRequest.operation's
# choices) so the two are reviewable independently: this one is a genuine
# schema change, that one is a no-op at the database level (a CharField's
# `choices` aren't DB-enforced) — bundling them would make this diff harder
# to review cleanly.
import django.core.validators
import django.db.models.deletion
from decimal import Decimal
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounting', '0004_schedule_revenue_integrity_check'),
        ('billing', '0012_idempotent_requests'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # Frozen role snapshots (financial roadmap Task 15) — nullable on
        # these three pre-existing models specifically because historical
        # rows predate this tracking. NULL is a permanent, honest "not
        # captured" state; it is never backfilled from a user's current
        # role, which would misrepresent an unverified guess as a verified
        # historical fact (User.role is mutable via the Django admin).
        migrations.AddField(
            model_name='cashiershift',
            name='closed_by_role',
            field=models.CharField(
                blank=True,
                choices=[('PATIENT', 'Patient'), ('DOCTOR', 'Doctor'), ('SECRETARY', 'Secretary'), ('MANAGER', 'Manager')],
                max_length=20, null=True,
            ),
        ),
        migrations.AddField(
            model_name='creditnote',
            name='approved_by_role',
            field=models.CharField(
                blank=True,
                choices=[('PATIENT', 'Patient'), ('DOCTOR', 'Doctor'), ('SECRETARY', 'Secretary'), ('MANAGER', 'Manager')],
                max_length=20, null=True,
            ),
        ),
        migrations.AddField(
            model_name='refund',
            name='approved_by_role',
            field=models.CharField(
                blank=True,
                choices=[('PATIENT', 'Patient'), ('DOCTOR', 'Doctor'), ('SECRETARY', 'Secretary'), ('MANAGER', 'Manager')],
                max_length=20, null=True,
            ),
        ),
        # The net active write-off amount — always recomputed from
        # non-reversed WriteOff rows (services._recompute_written_off_amount),
        # never incremented/decremented. Same convention as paid_amount/
        # credited_amount/refunded_amount.
        migrations.AddField(
            model_name='invoice',
            name='written_off_amount',
            field=models.DecimalField(
                decimal_places=2, default=Decimal('0.00'), max_digits=10,
                validators=[django.core.validators.MinValueValidator(Decimal('0.00'))],
            ),
        ),
        migrations.CreateModel(
            name='WriteOff',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('amount', models.DecimalField(
                    decimal_places=2, max_digits=10,
                    validators=[django.core.validators.MinValueValidator(Decimal('0.01'))],
                )),
                ('reason_code', models.CharField(max_length=64)),
                # No legacy rows exist for this brand-new model, so — unlike
                # the retrofit above — the role snapshot is required from day one.
                ('approved_by_role', models.CharField(
                    choices=[('PATIENT', 'Patient'), ('DOCTOR', 'Doctor'), ('SECRETARY', 'Secretary'), ('MANAGER', 'Manager')],
                    max_length=20,
                )),
                ('approved_by', models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT, related_name='approved_write_offs',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('invoice', models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT, related_name='write_offs', to='billing.invoice',
                )),
                ('journal_entry', models.ForeignKey(
                    blank=True, null=True, on_delete=django.db.models.deletion.PROTECT,
                    related_name='+', to='accounting.journalentry',
                )),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
        migrations.CreateModel(
            name='WriteOffReversal',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('reason_code', models.CharField(max_length=64)),
                ('reversed_by_role', models.CharField(
                    choices=[('PATIENT', 'Patient'), ('DOCTOR', 'Doctor'), ('SECRETARY', 'Secretary'), ('MANAGER', 'Manager')],
                    max_length=20,
                )),
                ('journal_entry', models.ForeignKey(
                    blank=True, null=True, on_delete=django.db.models.deletion.PROTECT,
                    related_name='+', to='accounting.journalentry',
                )),
                ('reversed_by', models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT, related_name='reversed_write_offs',
                    to=settings.AUTH_USER_MODEL,
                )),
                # The one-reversal-only invariant enforced at the database
                # level, not just in application code (financial roadmap
                # Task 15) — a OneToOneField's implicit unique constraint.
                ('write_off', models.OneToOneField(
                    on_delete=django.db.models.deletion.PROTECT, related_name='reversal', to='billing.writeoff',
                )),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddConstraint(
            model_name='writeoff',
            constraint=models.CheckConstraint(
                condition=models.Q(('reason_code', ''), _negated=True), name='writeoff_reason_code_required',
            ),
        ),
        migrations.AddConstraint(
            model_name='writeoffreversal',
            constraint=models.CheckConstraint(
                condition=models.Q(('reason_code', ''), _negated=True), name='writeoffreversal_reason_code_required',
            ),
        ),
    ]
