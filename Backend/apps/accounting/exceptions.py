"""Domain exceptions for the accounting core.

Every one of these is an invariant violation, never a user-input problem — a
caller catching one has a bug to fix, not a message to relay. Nothing here
subclasses DRF's ValidationError on purpose: the ledger raises loudly and lets
the caller decide how (or whether) to translate that for an API response.
"""


class AccountingError(Exception):
    """Base class for every accounting-core invariant violation."""


class ImmutableAccountCodeError(AccountingError):
    """Raised when `code` is changed on an `Account` already in use."""


class GroupAccountNotPostableError(AccountingError):
    """Raised when a posting targets a group (non-leaf) account."""


class InactiveAccountError(AccountingError):
    """Raised when a posting targets an inactive account."""


class UnmappedPurposeError(AccountingError):
    """Raised by `AccountMap.resolve()` when no account matches the purpose."""


class OverlappingPeriodError(AccountingError):
    """Raised when a `Period` would overlap an existing one."""


# --- Task 5 — the ledger and posting engine -------------------------------------

class ImmutableLedgerError(AccountingError):
    """Raised by JournalEntry/JournalLine save()/delete() on an existing row —
    posted entries are corrected by reversal, never edited or deleted."""


class ImbalancedEntryError(AccountingError):
    """Raised when a draft posting's Σdebit != Σcredit. No tolerance, ever."""


class StructureError(AccountingError):
    """Raised for a malformed draft: fewer than two lines, a line with both
    (or neither) side non-zero, or a negative amount."""


class PartyRequiredError(AccountingError):
    """Raised when a RECEIVABLE/PAYABLE line carries no party."""


class PartyForbiddenError(AccountingError):
    """Raised when a non-RECEIVABLE/PAYABLE line carries a party."""


class NoPeriodForDateError(AccountingError):
    """Raised when no `Period` covers a posting's date."""


class PeriodClosedError(AccountingError):
    """Raised when posting into a CLOSED period."""


class ReasonCodeRequiredError(AccountingError):
    """Raised when a reversal is attempted with no reason_code."""
