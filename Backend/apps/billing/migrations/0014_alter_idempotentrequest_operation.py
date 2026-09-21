# Financial roadmap Task 15 — no-op at the database level: adds
# WRITE_OFF_INVOICE/REVERSE_WRITE_OFF to FinancialOperation, which only
# changes IdempotentRequest.operation's `choices` metadata (a CharField's
# choices are not DB-enforced). Kept as its own migration, separate from
# 0013's real schema change, so this purely-cosmetic diff doesn't get lost
# inside a migration that actually alters the database.
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('billing', '0013_write_off_and_role_snapshots'),
    ]

    operations = [
        migrations.AlterField(
            model_name='idempotentrequest',
            name='operation',
            field=models.CharField(
                choices=[
                    ('ISSUE_REFUND', 'Issue refund'),
                    ('ISSUE_CREDIT_NOTE', 'Issue credit note'),
                    ('RECORD_CASH_MOVEMENT', 'Record cash movement'),
                    ('RECORD_PAYMENT', 'Record payment'),
                    ('WRITE_OFF_INVOICE', 'Write off invoice'),
                    ('REVERSE_WRITE_OFF', 'Reverse write-off'),
                ],
                max_length=32,
            ),
        ),
    ]
