"""Pure ASGI guard for `--auth none` mode: blocks DNS rebinding (Host check)
and cross-site requests (Origin check) on both http and websocket scopes.
A no-op in password mode. Env is read per request."""

from __future__ import annotations

import json
from urllib.parse import urlsplit

from .. import _env
from .deps import auth_mode

LOOPBACK_NAMES = {"127.0.0.1", "localhost", "::1"}


def allowed_hosts() -> set[str]:
    extra = _env.getenv("ALLOWED_HOSTS", "")
    return LOOPBACK_NAMES | {h.strip().lower() for h in extra.split(",") if h.strip()}


def _host_of(host_header: str) -> str:
    return (urlsplit("//" + host_header).hostname or "").lower()


class LocalGuardMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket") or auth_mode() != "none":
            await self.app(scope, receive, send)
            return

        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
        allowed = allowed_hosts()
        error = None
        try:
            if _host_of(headers.get("host", "")) not in allowed:
                error = "Host not allowed"
            elif "origin" in headers and (urlsplit(headers["origin"]).hostname or "").lower() not in allowed:
                error = "Origin not allowed"
        except ValueError:
            error = "Host not allowed"

        if error is None:
            await self.app(scope, receive, send)
            return

        if scope["type"] == "websocket":
            await receive()  # websocket.connect
            await send({"type": "websocket.close", "code": 1008})
            return
        body = json.dumps({"error": error}).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 403,
                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
            }
        )
        await send({"type": "http.response.body", "body": body})
