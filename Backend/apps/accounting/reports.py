"""Financial statements derived purely from the ledger (financial roadmap
Task 9). No import from apps.billing — same boundary rule as Task 5
("every apps/accounting test passes without importing anything from billing").

The balance sheet balances (Assets == Liabilities + Equity, exactly, with no
year-end closing entry needed) as a direct corollary of the ledger's own
Σdebit == Σcredit invariant — see the derivation in each function's docstring
counterpart test in tests/test_accounting_reports.py.
"""
from decimal import Decimal

from django.db.models import Sum
from django.utils import timezone

from apps.core.enums import RootType

from .models import Account, JournalLine
from .services import account_balance, trial_balance  # re-exported for convenience

__all__ = ["trial_balance", "income_statement", "balance_sheet"]

# Root types whose normal balance is a credit (liabilities, equity, income);
# assets and expenses are debit-normal. Reports show every figure positive in
# its conventional direction, unlike the raw ledger `debit - credit` balance.
_CREDIT_NORMAL_ROOTS = (RootType.LIABILITY, RootType.EQUITY, RootType.INCOME)


def _reported_amount(account, raw_balance):
    return -raw_balance if account.root_type in _CREDIT_NORMAL_ROOTS else raw_balance


def income_statement(start_date, end_date):
    """Revenue and expenses recognised between `start_date` and `end_date`
    (inclusive) — a period statement, unlike the balance sheet's cumulative
    figures."""
    rows_by_section = {"revenue": [], "expenses": []}
    totals = {"revenue": Decimal("0.00"), "expenses": Decimal("0.00")}

    for root_type, section in ((RootType.INCOME, "revenue"), (RootType.EXPENSE, "expenses")):
        for acc in Account.objects.filter(root_type=root_type, is_group=False):
            agg = JournalLine.objects.filter(
                account=acc, entry__posting_date__gte=start_date, entry__posting_date__lte=end_date,
            ).aggregate(debit=Sum("debit"), credit=Sum("credit"))
            debit = agg["debit"] or Decimal("0.00")
            credit = agg["credit"] or Decimal("0.00")
            if not debit and not credit:
                continue
            amount = _reported_amount(acc, debit - credit)
            rows_by_section[section].append({
                "account_code": acc.code, "account_name": acc.name, "amount": amount,
            })
            totals[section] += amount

    return {
        "start_date": start_date,
        "end_date": end_date,
        "revenue": rows_by_section["revenue"],
        "total_revenue": totals["revenue"],
        "expenses": rows_by_section["expenses"],
        "total_expense": totals["expenses"],
        "net_income": totals["revenue"] - totals["expenses"],
    }


def balance_sheet(as_of=None):
    """Assets / Liabilities / Equity as of `as_of` (default: today). Cumulative
    net income (all INCOME/EXPENSE activity to date) is folded into equity as
    "Current Year Earnings" so the statement balances without ever running a
    year-end closing entry — the ledger never zeroes P&L accounts."""
    as_of = as_of or timezone.localdate()

    def _group(root_type):
        rows = []
        total = Decimal("0.00")
        for acc in Account.objects.filter(root_type=root_type, is_group=False):
            raw = account_balance(acc, as_of=as_of)
            if not raw:
                continue
            amount = _reported_amount(acc, raw)
            rows.append({"account_code": acc.code, "account_name": acc.name, "amount": amount})
            total += amount
        return rows, total

    asset_rows, total_assets = _group(RootType.ASSET)
    liability_rows, total_liabilities = _group(RootType.LIABILITY)
    equity_rows, total_equity = _group(RootType.EQUITY)
    _income_rows, total_revenue = _group(RootType.INCOME)
    _expense_rows, total_expense = _group(RootType.EXPENSE)

    net_income = total_revenue - total_expense
    if net_income:
        equity_rows = equity_rows + [{
            "account_code": None, "account_name": "Current Year Earnings", "amount": net_income,
        }]
    total_equity += net_income

    return {
        "as_of": as_of,
        "assets": asset_rows,
        "total_assets": total_assets,
        "liabilities": liability_rows,
        "total_liabilities": total_liabilities,
        "equity": equity_rows,
        "total_equity": total_equity,
        "is_balanced": total_assets == total_liabilities + total_equity,
    }
