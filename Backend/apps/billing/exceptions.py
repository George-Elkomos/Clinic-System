"""Domain exceptions for billing invariants (financial roadmap Task 11).

Same reasoning as `apps.accounting.exceptions`: these are invariant
violations, not user-input problems, so they deliberately do not subclass
DRF's `ValidationError`. Bad *input* to a service function still raises
`ValidationError` — the API layer relays that to the caller.

`apps.core.exceptions.plain_language_exception_handler` translates every
`BillingError` into a clean REST response; most map to 400, but a subclass
may set `http_status`/`code` to override that (see the two idempotency
exceptions below, which are 409s).
"""
from rest_framework import status


class BillingError(Exception):
    """Base class for every billing invariant violation."""

    http_status = status.HTTP_400_BAD_REQUEST
    code = "business_rule_violation"


class ClosedShiftError(BillingError):
    """Raised when a CLOSED `CashierShift` is edited or deleted.

    A closed shift is the record of what was counted in the drawer and what
    was posted for the difference; a correction is a new shift or a reversing
    journal entry, never an edit.
    """


class InvoiceNumberImmutableError(BillingError):
    """Raised when `Invoice.invoice_number` is changed after it was first set
    (financial roadmap Task 14) — a real, gapless, tax-relevant sequence
    number is never renumbered once issued."""


class CashMovementImmutableError(BillingError):
    """Raised when a `CashMovement` (financial roadmap Task 17) is edited or
    deleted. A posted cash movement is corrected the same way every other
    financial record here is: a new, offsetting movement, never an edit."""


class WriteOffImmutableError(BillingError):
    """Raised when a `WriteOff` or `WriteOffReversal` (financial roadmap
    Task 15) is deleted. A write-off is corrected only by an explicit
    `WriteOffReversal` — never by editing or deleting either record."""


class IdempotencyKeyConflictError(BillingError):
    """Raised when a client's Idempotency-Key was already used for a request
    with a different fingerprint (different invoice, amount, reason, shift,
    etc.). The key is not reusable for a different logical request."""

    http_status = status.HTTP_409_CONFLICT
    code = "idempotency_key_reused_with_different_request"


class ApprovalThresholdExceededError(BillingError):
    """Raised when the acting user's role/amount combination doesn't meet a
    financial operation's approval policy (financial roadmap Task 15) — e.g.
    a SECRETARY attempting a refund/credit-note/write-off above its
    configured threshold, a non-manager attempting an unconditionally
    manager-only operation (cancellation, write-off reversal), or any role
    other than SECRETARY/MANAGER attempting any of these at all.

    Raised from inside the service function itself, under the same lock the
    operation's own invariants are checked against — never only from the
    DRF view — so a direct call from a shell, the admin, or a background job
    cannot bypass this policy the way a view-only permission class could be.
    """

    http_status = status.HTTP_403_FORBIDDEN
    code = "approval_threshold_exceeded"


class IdempotencyRequestInProgressError(BillingError):
    """Raised when a claimed Idempotency-Key is found still IN_PROGRESS by
    another attempt. In normal operation this should be unreachable — the
    claim, the operation, and its completion all happen in one transaction,
    so a concurrent conflicting insert only ever observes a *committed*
    (COMPLETED) row or no row at all (rolled back) — but it is handled
    defensively rather than assumed impossible."""

    http_status = status.HTTP_409_CONFLICT
    code = "idempotency_request_in_progress"
