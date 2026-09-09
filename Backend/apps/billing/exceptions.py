"""Domain exceptions for billing invariants (financial roadmap Task 11).

Same reasoning as `apps.accounting.exceptions`: these are invariant
violations, not user-input problems, so they deliberately do not subclass
DRF's `ValidationError`. Bad *input* to a service function still raises
`ValidationError` — the API layer relays that to the caller.
"""


class BillingError(Exception):
    """Base class for every billing invariant violation."""


class ClosedShiftError(BillingError):
    """Raised when a CLOSED `CashierShift` is edited or deleted.

    A closed shift is the record of what was counted in the drawer and what
    was posted for the difference; a correction is a new shift or a reversing
    journal entry, never an edit.
    """
