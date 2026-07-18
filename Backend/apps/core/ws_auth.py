"""JWT auth for WebSocket connections (Django Channels).

The browser's native WebSocket API can't set an Authorization header, so the
access token travels as a query parameter instead: `?token=<access>`. This
mirrors `rest_framework_simplejwt.authentication.JWTAuthentication` (same
token, same validation) but for the ASGI scope instead of a DRF request.
"""
from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from django.contrib.auth.models import AnonymousUser
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.tokens import AccessToken


@database_sync_to_async
def _user_from_token(raw_token):
    from apps.users.models import User

    try:
        validated = AccessToken(raw_token)
        return User.objects.get(pk=validated["user_id"])
    except (TokenError, InvalidToken, User.DoesNotExist, KeyError):
        return AnonymousUser()


class JWTAuthMiddleware(BaseMiddleware):
    async def __call__(self, scope, receive, send):
        query = parse_qs((scope.get("query_string") or b"").decode())
        token = (query.get("token") or [None])[0]
        scope["user"] = await _user_from_token(token) if token else AnonymousUser()
        return await super().__call__(scope, receive, send)
