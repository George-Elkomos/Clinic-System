"""WebSocket consumer for the doctor's live queue page.

Push-only: the socket never carries queue data itself — it just tells the
client "something changed" and the client re-fetches via the existing,
already-tested REST endpoint (`GET /api/appointments/my-queue/`). That keeps
one source of truth for how the queue is computed instead of duplicating that
logic here.
"""
from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from apps.core.enums import RoleChoices


def group_for_doctor(doctor_profile_id):
    return f"doctor-queue-{doctor_profile_id}"


class DoctorQueueConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        user = self.scope["user"]
        if not (user and user.is_authenticated and user.role == RoleChoices.DOCTOR):
            await self.close(code=4401)
            return

        profile_id = await self._doctor_profile_id(user)
        if profile_id is None:
            await self.close(code=4403)
            return

        self.group_name = group_for_doctor(profile_id)
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    # Called for every "queue.update" group_send — see appointments/signals.py.
    async def queue_update(self, event):
        await self.send_json({"type": "queue_updated"})

    @database_sync_to_async
    def _doctor_profile_id(self, user):
        return getattr(getattr(user, "doctor_profile", None), "id", None)
