from django.urls import re_path

from .consumers import DoctorQueueConsumer

websocket_urlpatterns = [
    re_path(r"^ws/appointments/queue/$", DoctorQueueConsumer.as_asgi()),
]
