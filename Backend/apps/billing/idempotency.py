"""API/business-level idempotency for financial write operations.

This is layered *on top of*, and is entirely separate from, the ledger's own
`apps.accounting.services.post()` idempotency (`JournalEntry.idempotency_key`):

    request/business idempotency (this module)
        -> one domain financial object (Refund/CreditNote/CashMovement/Payment)
            -> ledger idempotency (unchanged, apps.accounting.services.post)
                -> one accounting posting

Nothing here writes to `JournalEntry`/`JournalLine`, and nothing here
replaces or weakens the ledger's own idempotency — see `IdempotentRequest`'s
docstring in `models.py` for the full design rationale.

Used by `issue_credit_note`, `issue_refund`, `record_cash_movement`, and
`record_payment` in `services.py`, each via an optional `idempotency_key`
keyword argument — the mechanism protects any caller (an API view, a future
internal workflow, a management command), not just DRF requests.
"""
import hashlib
import json
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.core.enums import IdempotencyStatus

from .exceptions import IdempotencyKeyConflictError, IdempotencyRequestInProgressError
from .models import IdempotentRequest


def compute_fingerprint(**fields):
    """A stable hash of a financial write request's business-significant
    fields — used to detect a same-key-different-payload replay.

    Every `Decimal` is normalized to a fixed 2-place string first, so
    `"100"`/`"100.0"`/`"100.00"` fingerprint identically; nothing here is
    ever compared as a `float`. Field order doesn't matter (the dict is
    sorted before hashing) but which fields are passed does — callers should
    pass exactly the fields that make two requests "the same request"
    (invoice/shift id, amount, reason, movement type, ...), never dimensions
    like the approving user (already part of the uniqueness scope) or
    anything not business-significant.
    """
    normalized = {}
    for name, value in fields.items():
        if isinstance(value, Decimal):
            value = str(value.quantize(Decimal("0.01")))
        elif value is not None:
            value = str(value)
        normalized[name] = value
    canonical = json.dumps(normalized, sort_keys=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def claim(*, user, operation, key, fingerprint):
    """Claim `key` for `(user, operation)`, or resolve a replay.

    MUST be called from inside the same `transaction.atomic()` block that
    performs the operation it protects (every call site in services.py
    already is one). Returns:

    - `None` — a fresh claim: the caller must now perform the operation and
      call `complete()` with its result id.
    - an `IdempotentRequest` — a valid replay of an already-completed
      request with a matching fingerprint. The caller must resolve
      `result_id` back to its own domain model and return that object
      *without* re-running the operation.

    Raises `IdempotencyKeyConflictError` if `key` was already used for a
    request with a different fingerprint, or
    `IdempotencyRequestInProgressError` if it is claimed but not yet
    completed (see the model docstring for why this should be unreachable in
    normal operation).
    """
    try:
        with transaction.atomic():  # savepoint: an IntegrityError here must
            # not poison the outer transaction the caller is still using.
            IdempotentRequest.objects.create(
                user=user, operation=operation, key=key, fingerprint=fingerprint,
            )
        return None
    except IntegrityError:
        pass

    existing = IdempotentRequest.objects.get(user=user, operation=operation, key=key)
    if existing.fingerprint != fingerprint:
        raise IdempotencyKeyConflictError(
            f"Idempotency-Key {key!r} was already used for a different {operation} request."
        )
    if existing.status != IdempotencyStatus.COMPLETED:
        raise IdempotencyRequestInProgressError(
            f"Another request with Idempotency-Key {key!r} is still being processed."
        )
    return existing


def complete(*, user, operation, key, result_id):
    """Mark a freshly-claimed key as completed, inside the same transaction
    the operation itself ran in — so a later failure in that same
    transaction still rolls this back along with everything else."""
    IdempotentRequest.objects.filter(user=user, operation=operation, key=key).update(
        status=IdempotencyStatus.COMPLETED, result_id=result_id, updated_at=timezone.now(),
    )
