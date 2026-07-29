"""Thread-local request context so audit signals can record who did what.

Django signals don't receive the request, so we stash the current user and a
little request metadata in thread-local storage for the duration of the request.
"""
import threading

_state = threading.local()


def get_current_user():
    # Resolved lazily against the live request (not a value snapshotted at
    # middleware time) because DRF's JWT authentication only populates
    # request.user once the view's perform_authentication() runs, which is
    # after this middleware's pre-view phase but before any signal fired by
    # the view's own db writes (e.g. audit's post_save receiver).
    request = getattr(_state, "request", None)
    if request is None:
        return None
    user = getattr(request, "user", None)
    return user if (user and user.is_authenticated) else None


def get_current_request_meta():
    return {
        "ip_address": getattr(_state, "ip_address", None),
        "user_agent": getattr(_state, "user_agent", ""),
    }


def _client_ip(request):
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


class CurrentUserMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        _state.request = request
        _state.ip_address = _client_ip(request)
        _state.user_agent = request.META.get("HTTP_USER_AGENT", "")[:512]
        try:
            return self.get_response(request)
        finally:
            _state.request = None
            _state.ip_address = None
            _state.user_agent = ""
