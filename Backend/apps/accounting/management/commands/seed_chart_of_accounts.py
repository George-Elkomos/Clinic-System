"""Seed the clinic chart of accounts (financial roadmap Task 4).

Tree source: docs/financial-design/reference/clinic-chart-of-accounts.md §2.
Map source: same document §3, trimmed to the purposes apps/billing actually
resolves against as of Tasks 6-8 (self-pay only — no insurer/payer split yet,
that is Task 10).

Idempotent: safe to re-run. Existing accounts are matched by `code` and left
alone (an account's `code` is immutable once mapped, so re-running this
command must never attempt to update one).
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.accounting.models import Account, AccountMap
from apps.core.enums import AccountType as AT
from apps.core.enums import RootType as RT

# (code, name, account_type, [children...]) — is_group is `bool(children)`.
CHART = [
    ("1000", "Assets", "", RT.ASSET, [
        ("1100", "Current Assets", "", None, [
            ("1110", "Cash & Cash Equivalents", "", None, [
                ("1111", "Cash on Hand — Main Till", AT.CASH, None, []),
                ("1112", "Cash on Hand — Branch Tills", AT.CASH, None, []),
                ("1113", "Petty Cash", AT.CASH, None, []),
                ("1114", "Undeposited Receipts (in transit)", AT.CASH, None, []),
                ("1120", "Bank Accounts", "", None, [
                    ("1121", "Bank — Operating Account", AT.BANK, None, []),
                    ("1122", "Bank — Payer Settlement Account", AT.BANK, None, []),
                ]),
                ("1130", "Payment Gateway Clearing", AT.BANK, None, []),
            ]),
            ("1200", "Accounts Receivable", "", None, [
                ("1210", "AR — Patients (self-pay)", AT.RECEIVABLE, None, []),
                ("1220", "AR — Insurers", "", None, [
                    ("1221", "AR — Insurer (control account)", AT.RECEIVABLE, None, []),
                ]),
                ("1230", "AR — Corporate Accounts", AT.RECEIVABLE, None, []),
                ("1240", "AR — Unbilled Charges (accrued revenue)", AT.RECEIVABLE, None, []),
                ("1250", "AR — Claims Submitted, Not Adjudicated", AT.RECEIVABLE, None, []),
            ]),
            ("1300", "Inventory", "", None, [
                ("1310", "Pharmacy Inventory", AT.INVENTORY, None, []),
                ("1320", "Medical Consumables Inventory", AT.INVENTORY, None, []),
                ("1330", "Laboratory Reagents Inventory", AT.INVENTORY, None, []),
                ("1340", "Inventory Received Not Billed", AT.INVENTORY, None, []),
            ]),
            ("1400", "Prepayments & Other Current Assets", "", None, [
                ("1410", "Prepaid Expenses", "", None, []),
                ("1420", "Staff Advances", "", None, []),
                ("1430", "Supplier Advances", "", None, []),
                ("1440", "Recoverable Taxes", AT.TAX, None, []),
            ]),
        ]),
        ("1500", "Non-Current Assets", "", None, [
            ("1510", "Medical Equipment", AT.FIXED_ASSET, None, []),
            ("1511", "Accumulated Depreciation — Medical Equipment",
             AT.ACCUMULATED_DEPRECIATION, None, []),
            ("1520", "Furniture & Fixtures", AT.FIXED_ASSET, None, []),
            ("1521", "Accumulated Depreciation — Furniture",
             AT.ACCUMULATED_DEPRECIATION, None, []),
            ("1530", "IT & Office Equipment", AT.FIXED_ASSET, None, []),
            ("1531", "Accumulated Depreciation — IT Equipment",
             AT.ACCUMULATED_DEPRECIATION, None, []),
            ("1540", "Leasehold Improvements", AT.FIXED_ASSET, None, []),
            ("1541", "Accumulated Depreciation — Leasehold",
             AT.ACCUMULATED_DEPRECIATION, None, []),
            ("1550", "Buildings", AT.FIXED_ASSET, None, []),
            ("1560", "Capital Work in Progress", AT.FIXED_ASSET, None, []),
            ("1570", "Intangible Assets (software, licences)", AT.FIXED_ASSET, None, []),
        ]),
    ]),
    ("2000", "Liabilities", "", RT.LIABILITY, [
        ("2100", "Current Liabilities", "", None, [
            ("2110", "Accounts Payable — Suppliers", AT.PAYABLE, None, []),
            ("2120", "Accounts Payable — Practitioners (fee-for-service)",
             AT.PAYABLE, None, []),
            ("2130", "Accrued Expenses", "", None, []),
            ("2140", "Payroll Liabilities", "", None, [
                ("2141", "Salaries Payable", AT.PAYABLE, None, []),
                ("2142", "Statutory Deductions Payable", AT.PAYABLE, None, []),
                ("2143", "End-of-Service / Gratuity Provision", AT.PAYABLE, None, []),
            ]),
            ("2150", "Tax Liabilities", "", None, [
                ("2151", "VAT / Sales Tax Payable", AT.TAX, None, []),
                ("2152", "Withholding Tax Payable", AT.TAX, None, []),
            ]),
            ("2200", "Patient & Payer Liabilities", "", None, [
                ("2210", "Patient Deposits Held", AT.PATIENT_DEPOSIT, None, []),
                ("2220", "Patient Credit Balances (overpayments)",
                 AT.PATIENT_DEPOSIT, None, []),
                ("2230", "Payer Overpayments / Refunds Due", AT.PATIENT_DEPOSIT, None, []),
                ("2240", "Unearned Revenue — Prepaid Packages",
                 AT.DEFERRED_REVENUE, None, []),
                ("2250", "Unearned Revenue — Memberships", AT.DEFERRED_REVENUE, None, []),
            ]),
        ]),
        ("2500", "Non-Current Liabilities", "", None, [
            ("2510", "Long-Term Loans", AT.PAYABLE, None, []),
            ("2520", "Lease Liabilities", AT.PAYABLE, None, []),
        ]),
    ]),
    ("3000", "Equity", "", RT.EQUITY, [
        ("3100", "Share Capital / Owner's Capital", AT.EQUITY, None, []),
        ("3200", "Retained Earnings", AT.EQUITY, None, []),
        ("3300", "Current Year Earnings", AT.EQUITY, None, []),
        ("3400", "Drawings / Distributions", AT.EQUITY, None, []),
    ]),
    ("4000", "Revenue", "", RT.INCOME, [
        ("4100", "Clinical Service Revenue — Gross", "", None, [
            ("4110", "Consultation Revenue", "", None, [
                ("4111", "Outpatient Consultation", AT.INCOME, None, []),
                ("4112", "Follow-up Consultation", AT.INCOME, None, []),
                ("4113", "Telemedicine Consultation", AT.INCOME, None, []),
                ("4114", "Inpatient Visit", AT.INCOME, None, []),
                ("4115", "Emergency Consultation", AT.INCOME, None, []),
            ]),
            ("4120", "Diagnostic Revenue", "", None, [
                ("4121", "Laboratory", AT.INCOME, None, []),
                ("4122", "Radiology / Imaging", AT.INCOME, None, []),
                ("4123", "Cardiology Diagnostics", AT.INCOME, None, []),
                ("4124", "Other Diagnostics", AT.INCOME, None, []),
            ]),
            ("4130", "Procedure Revenue", "", None, [
                ("4131", "Minor Procedures", AT.INCOME, None, []),
                ("4132", "Major Procedures / Surgery", AT.INCOME, None, []),
                ("4133", "Day-Case Procedures", AT.INCOME, None, []),
            ]),
            ("4140", "Therapy & Rehabilitation Revenue", AT.INCOME, None, []),
            ("4150", "Inpatient Revenue", "", None, [
                ("4151", "Room & Bed Charges", AT.INCOME, None, []),
                ("4152", "Nursing Charges", AT.INCOME, None, []),
                ("4153", "ICU / Critical Care", AT.INCOME, None, []),
            ]),
            ("4160", "Pharmacy Revenue", AT.INCOME, None, []),
            ("4170", "Medical Consumables Revenue", AT.INCOME, None, []),
            ("4180", "Other Clinical Revenue", AT.INCOME, None, []),
        ]),
        ("4500", "Contra-Revenue", "", None, [
            ("4510", "Contractual Adjustments — Insurers",
             AT.CONTRACTUAL_ADJUSTMENT, None, []),
            ("4520", "Contractual Adjustments — Corporate",
             AT.CONTRACTUAL_ADJUSTMENT, None, []),
            ("4530", "Discounts — Policy (staff, charity, hardship)", AT.INCOME, None, []),
            ("4540", "Discounts — Promotional", AT.INCOME, None, []),
            ("4550", "Entitlement / Free Follow-up Value Forgone", AT.INCOME, None, []),
            ("4560", "Claim Denials Written Off", AT.INCOME, None, []),
            ("4580", "Refunds & Returns", AT.INCOME, None, []),
        ]),
        ("4900", "Non-Clinical Revenue", "", None, [
            ("4910", "Rental / Concession Income", AT.INCOME, None, []),
            ("4920", "Medical Records / Certificate Fees", AT.INCOME, None, []),
            ("4930", "Registration Fees", AT.INCOME, None, []),
            ("4940", "No-Show / Late-Cancellation Fees", AT.INCOME, None, []),
            ("4950", "Interest Income", AT.INCOME, None, []),
            ("4960", "Foreign Exchange Gain", AT.INCOME, None, []),
        ]),
    ]),
    ("5000", "Expenses", "", RT.EXPENSE, [
        ("5100", "Cost of Services", "", None, [
            ("5110", "Pharmacy Cost of Goods Sold", AT.COGS, None, []),
            ("5120", "Medical Consumables Consumed", AT.COGS, None, []),
            ("5130", "Laboratory Reagents Consumed", AT.COGS, None, []),
            ("5140", "Outsourced Diagnostics", AT.EXPENSE, None, []),
            ("5150", "Practitioner Fees (fee-for-service)", AT.EXPENSE, None, []),
            ("5160", "Referral Fees", AT.EXPENSE, None, []),
        ]),
        ("5200", "Personnel Costs", "", None, [
            ("5210", "Clinical Salaries", "", None, []),
            ("5220", "Non-Clinical Salaries", "", None, []),
            ("5230", "Benefits & Allowances", "", None, []),
            ("5240", "Statutory Contributions", "", None, []),
            ("5250", "Training & CME", "", None, []),
            ("5260", "Gratuity / EOS Expense", "", None, []),
        ]),
        ("5300", "Facility & Operating Costs", "", None, [
            ("5310", "Rent / Lease", "", None, []),
            ("5320", "Utilities", "", None, []),
            ("5330", "Cleaning & Housekeeping", "", None, []),
            ("5340", "Equipment Maintenance", "", None, []),
            ("5350", "Medical Waste Disposal", "", None, []),
            ("5360", "Insurance (property, liability, malpractice)", "", None, []),
            ("5370", "Licences & Accreditation", "", None, []),
        ]),
        ("5400", "Administrative Costs", "", None, [
            ("5410", "IT & Software Subscriptions", "", None, []),
            ("5420", "Professional Fees (legal, audit)", "", None, []),
            ("5430", "Marketing & Patient Outreach", "", None, []),
            ("5440", "Office Supplies", "", None, []),
            ("5450", "Telephone & Internet", "", None, []),
            ("5460", "Travel", "", None, []),
            ("5470", "Bank & Payment Gateway Charges", "", None, []),
            ("5480", "Bad Debt Expense — Patient", AT.WRITE_OFF, None, []),
            ("5490", "Bad Debt Expense — Payer", AT.WRITE_OFF, None, []),
        ]),
        ("5500", "Depreciation & Amortisation", "", None, [
            ("5510", "Depreciation — Medical Equipment", AT.EXPENSE, None, []),
            ("5520", "Depreciation — Other", AT.EXPENSE, None, []),
            ("5530", "Amortisation — Intangibles", AT.EXPENSE, None, []),
        ]),
        ("5600", "Financial & Other", "", None, [
            ("5610", "Interest Expense", "", None, []),
            ("5620", "Foreign Exchange Loss", "", None, []),
            ("5630", "Inventory Write-off / Expiry", AT.EXPENSE, None, []),
            ("5640", "Cash Variance (till over/short)", AT.EXPENSE, None, []),
            ("5690", "Rounding Differences", AT.ROUND_OFF, None, []),
        ]),
    ]),
]

# (purpose, qualifier, code) — only the purposes apps/billing resolves against
# today (Tasks 6-8: self-pay invoicing, cash/card/bank receipt, deposits,
# refunds/write-offs). Insurer/payer purposes are Task 10, not seeded yet.
MAP_ENTRIES = [
    ("AR_PATIENT", "", "1210"),
    ("REVENUE_BY_SERVICE_CATEGORY", "CONSULTATION", "4111"),
    ("REVENUE_BY_SERVICE_CATEGORY", "LAB_TEST", "4121"),
    ("REVENUE_BY_SERVICE_CATEGORY", "PROCEDURE", "4131"),
    ("REVENUE_BY_SERVICE_CATEGORY", "RADIOLOGY", "4122"),
    ("REVENUE_BY_SERVICE_CATEGORY", "OTHER", "4180"),
    ("DISCOUNT", "", "4530"),
    ("CASH_DEFAULT", "", "1111"),
    ("BANK_DEFAULT", "", "1121"),
    ("GATEWAY_CLEARING", "CARD", "1130"),
    ("PATIENT_DEPOSIT_LIABILITY", "", "2210"),
    ("PATIENT_CREDIT_BALANCE", "", "2220"),
    ("BAD_DEBT_PATIENT", "", "5480"),
    ("REFUND_CONTRA", "", "4580"),
]


class Command(BaseCommand):
    help = "Seed the clinic chart of accounts and the purpose->account map."

    @transaction.atomic
    def handle(self, *args, **options):
        created, existing = 0, 0

        def _seed(nodes, root_type, parent):
            nonlocal created, existing
            for code, name, account_type, _unused, children in nodes:
                account, was_created = Account.objects.get_or_create(
                    code=code,
                    defaults={
                        "name": name,
                        "parent": parent,
                        "root_type": root_type,
                        "account_type": account_type or "",
                        "is_group": bool(children),
                    },
                )
                created += int(was_created)
                existing += int(not was_created)
                if children:
                    _seed(children, root_type, account)

        for code, name, _account_type, root_type, children in CHART:
            account, was_created = Account.objects.get_or_create(
                code=code,
                defaults={
                    "name": name,
                    "parent": None,
                    "root_type": root_type,
                    "account_type": "",
                    "is_group": True,
                },
            )
            created += int(was_created)
            existing += int(not was_created)
            _seed(children, root_type, account)

        map_created, map_existing = 0, 0
        for purpose, qualifier, code in MAP_ENTRIES:
            account = Account.objects.get(code=code)
            _, was_created = AccountMap.objects.get_or_create(
                purpose=purpose, qualifier=qualifier, defaults={"account": account},
            )
            map_created += int(was_created)
            map_existing += int(not was_created)

        self.stdout.write(self.style.SUCCESS(
            f"Accounts: {created} created, {existing} already present. "
            f"Account map: {map_created} created, {map_existing} already present."
        ))
