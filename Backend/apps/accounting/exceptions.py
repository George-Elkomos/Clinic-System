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
