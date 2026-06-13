"""Thread-local request context so audit signals can record who did what.

Django signals don't receive the request, so we stash the current user and a
little request metadata in thread-local storage for the duration of the request.
"""
import threading

_state = threading.local()


def get_current_user():
    return getattr(_state, "user", None)


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
        user = getattr(request, "user", None)
        _state.user = user if (user and user.is_authenticated) else None
        _state.ip_address = _client_ip(request)
        _state.user_agent = request.META.get("HTTP_USER_AGENT", "")[:512]
        try:
            return self.get_response(request)
        finally:
            _state.user = None
            _state.ip_address = None
            _state.user_agent = ""
