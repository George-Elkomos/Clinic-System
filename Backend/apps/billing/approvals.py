"""Financial roadmap Task 15 — approval-threshold enforcement.

A single, positive allow-list gate reused by every service function that has
an approval policy (`issue_credit_note`, `issue_refund`, `write_off_invoice`,
`close_shift`, `reverse_write_off`, `cancel_invoice`). Called from *inside*
each service function's own locked transactional path — never only from a
DRF view — so a direct call from a shell, the Django admin, or a background
job is bound by exactly the same policy an HTTP request would be. Views keep
only coarse RBAC (`IsSecretaryOrManager`/`IsManager`) for cheap, early
rejection; this is what actually decides whether the specific actor may
perform the specific action.
"""
from apps.core.enums import RoleChoices

from .exceptions import ApprovalThresholdExceededError


def require_authorization(*, actor, amount=None, threshold=None, operation_label):
    """Raise `ApprovalThresholdExceededError` unless `actor` is authorized.

    - MANAGER: always allowed, regardless of `amount`/`threshold`.
    - SECRETARY: allowed only when both `amount` and `threshold` are given
      and `amount <= threshold`.
    - Every other role (PATIENT, DOCTOR, an unauthenticated/None actor, or
      any future role) is always rejected — this is deny-by-default, not an
      enumerated block-list, so a new role added later is rejected until
      explicitly taught otherwise.
    - `threshold=None` collapses this to unconditional-manager-only (used by
      `cancel_invoice` and `reverse_write_off`, which have no threshold
      concept at all): a SECRETARY is rejected no matter what `amount` is.
    """
    role = getattr(actor, "role", None)
    if role == RoleChoices.MANAGER:
        return
    if (
        role == RoleChoices.SECRETARY
        and threshold is not None
        and amount is not None
        and amount <= threshold
    ):
        return
    raise ApprovalThresholdExceededError(
        f"{operation_label} requires manager approval "
        f"(threshold: {threshold if threshold is not None else 'manager-only'})."
    )
