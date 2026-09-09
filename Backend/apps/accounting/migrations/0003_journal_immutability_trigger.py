"""Database-level immutability guard for the ledger (Task 5).

Python's `JournalEntry.save()`/`delete()` and `JournalLine.save()`/`delete()`
overrides only catch instance-level ORM calls. A bulk `.update()`/`.delete()`
on a queryset never calls those overrides — Django issues a plain SQL
UPDATE/DELETE. This is the second, database-level layer: a trigger that
rejects any UPDATE or DELETE on either ledger table, full stop.

Postgres-only (this project's dev DB since Task 3; production is still
SQLite and out of scope for this migration — see SERVER_INFO.md).
"""
from django.db import migrations

CREATE_SQL = """
CREATE OR REPLACE FUNCTION accounting_forbid_journal_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION
        'journal entries are immutable — post a reversal instead (table: %, op: %)',
        TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_forbid_journalentry_mutation
    BEFORE UPDATE OR DELETE ON accounting_journalentry
    FOR EACH ROW EXECUTE FUNCTION accounting_forbid_journal_mutation();

CREATE TRIGGER trg_forbid_journalline_mutation
    BEFORE UPDATE OR DELETE ON accounting_journalline
    FOR EACH ROW EXECUTE FUNCTION accounting_forbid_journal_mutation();
"""

DROP_SQL = """
DROP TRIGGER IF EXISTS trg_forbid_journalentry_mutation ON accounting_journalentry;
DROP TRIGGER IF EXISTS trg_forbid_journalline_mutation ON accounting_journalline;
DROP FUNCTION IF EXISTS accounting_forbid_journal_mutation();
"""


class Migration(migrations.Migration):

    dependencies = [
        ("accounting", "0002_journalentry_journalline_and_more"),
    ]

    operations = [
        migrations.RunSQL(sql=CREATE_SQL, reverse_sql=DROP_SQL),
    ]
