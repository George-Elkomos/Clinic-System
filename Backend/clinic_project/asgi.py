import os

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "clinic_project.settings.dev")

# django.setup() must run (via get_asgi_application()) before importing anything
# that touches models/apps — including app routing modules — hence the import
# order below looks unusual but is required.
from django.core.asgi import get_asgi_application  # noqa: E402

django_asgi_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402

from apps.appointments.routing import websocket_urlpatterns  # noqa: E402
from apps.core.ws_auth import JWTAuthMiddleware  # noqa: E402

application = ProtocolTypeRouter({
    "http": django_asgi_app,
    "websocket": JWTAuthMiddleware(URLRouter(websocket_urlpatterns)),
})
