"""FastAPI application factory.

Mounts the REST API (1:1 contract with the Next.js backend's `src/app/api/*`
routes) and a `/ws` WebSocket replacing the Socket.IO mini-service. Serving
the actual frontend bundle is Phase 2 (frontend decoupling, not done yet) —
for now `/` serves a minimal placeholder page confirming the API is up.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
from contextlib import asynccontextmanager
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse

from .db import init_db
from .deps import auth_mode
from .local_guard import LocalGuardMiddleware
from .realtime import manager
from .security import SESSION_COOKIE_NAME, read_session_token
from .routes import auth, events, keys, projects, runs, seed, stats

PLACEHOLDER_HTML = """<!doctype html>
<html><head><title>AgentTrace</title></head>
<body style="font-family: system-ui; padding: 2rem;">
<h1>AgentTrace API is running</h1>
<p>The Python backend (FastAPI) is up. The web dashboard bundle isn't wired in
yet — that's Phase 2 of the Python migration (frontend decoupled from
Next.js, served here as a static bundle).</p>
<p>Try the API directly, e.g. <code>GET /api/stats</code> (requires a session
cookie) or <code>POST /api/events</code> (requires a project API key).</p>
</body></html>"""


@asynccontextmanager
async def _lifespan(app: FastAPI):
    init_db()
    poller = asyncio.create_task(manager.poll_forever())
    try:
        yield
    finally:
        poller.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await poller


def _same_origin_or_allowed(websocket: WebSocket) -> bool:
    """CSWSH guard: browsers attach the session cookie to cross-site WebSocket
    handshakes, so a browser `Origin` must match `Host` (or be explicitly
    allowed). Clients that send no Origin (scripts) are not browsers."""
    origin = websocket.headers.get("origin")
    if origin is None:
        return True
    try:
        parts = urlsplit(origin)
        origin_netloc, origin_host = parts.netloc.lower(), (parts.hostname or "").lower()
    except ValueError:
        return False
    if origin_netloc and origin_netloc == websocket.headers.get("host", "").lower():
        return True
    extra = os.getenv("AGENTTRACE_ALLOWED_HOSTS", "")
    return origin_host in {h.strip().lower() for h in extra.split(",") if h.strip()}


def create_app() -> FastAPI:
    app = FastAPI(title="AgentTrace", lifespan=_lifespan)

    app.add_middleware(LocalGuardMiddleware)

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request, exc: HTTPException):
        content = exc.detail if isinstance(exc.detail, dict) else {"error": exc.detail}
        return JSONResponse(status_code=exc.status_code, content=content)

    app.include_router(auth.router)
    app.include_router(projects.router)
    app.include_router(runs.project_runs_router)
    app.include_router(runs.runs_router)
    app.include_router(events.router)
    app.include_router(keys.router)
    app.include_router(stats.router)
    app.include_router(seed.router)

    @app.get("/", response_class=HTMLResponse)
    async def index():
        return PLACEHOLDER_HTML

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket):
        user_id = None
        if auth_mode() != "none":
            if not _same_origin_or_allowed(websocket):
                await websocket.close(code=1008)
                return
            token = websocket.cookies.get(SESSION_COOKIE_NAME)
            user_id = read_session_token(token) if token else None
            if not user_id:
                await websocket.close(code=1008)
                return
        await manager.connect(websocket)
        try:
            while True:
                message = await websocket.receive_json()
                action = message.get("action")
                run_id = message.get("runId")
                if action == "subscribe" and run_id:
                    await manager.subscribe(websocket, run_id, user_id)
                elif action == "unsubscribe" and run_id:
                    manager.unsubscribe(websocket, run_id)
                elif action == "replay" and run_id:
                    await manager.replay(websocket, run_id, message.get("events", []), message.get("speed", 1))
                elif action == "replay:stop" and run_id:
                    manager.stop_replay(websocket, run_id)
        except WebSocketDisconnect:
            pass
        finally:
            manager.disconnect(websocket)

    return app


app = create_app()
