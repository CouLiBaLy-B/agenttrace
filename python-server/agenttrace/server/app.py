"""FastAPI application factory.

Mounts the REST API and a `/ws` WebSocket, then serves the bundled static UI
(`agenttrace/server/static`, override with `AGENTTRACE_STATIC_DIR`) or, when
the bundle is absent, a minimal placeholder page.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.types import Scope

from .db import init_db
from .deps import auth_mode
from .local_guard import LocalGuardMiddleware
from .realtime import manager
from .security import SESSION_COOKIE_NAME, read_session_token
from .routes import auth, events, keys, projects, runs, seed, stats, timeline

DEFAULT_STATIC_DIR = Path(__file__).parent / "static"

PLACEHOLDER_HTML = """<!doctype html>
<html><head><title>AgentTrace</title></head>
<body style="font-family: system-ui; padding: 2rem;">
<h1>AgentTrace API is running</h1>
<p>The web dashboard bundle isn't included in this install. Build it from a
source checkout with <code>bun install &amp;&amp; bun run build:ui</code>, or
install a released wheel (<code>pip install 'deepagents-trace[server]'</code>).
The API is available under <code>/api/*</code>.</p>
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


class UIStaticFiles(StaticFiles):
    """Static bundle with cache headers safe across upgrades: content-hashed
    `_next/static/*` chunks are immutable, everything else (the HTML pages,
    which reference those chunks by name) is revalidated on every load so a
    `pip install -U` never leaves a cached page pointing at removed chunks."""

    async def get_response(self, path: str, scope: Scope):
        response = await super().get_response(path, scope)
        if path.replace(os.sep, "/").startswith("_next/static/"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        else:
            response.headers["Cache-Control"] = "no-cache"
        return response


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
    app.include_router(timeline.router)

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

    @app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
    async def api_not_found(path: str):
        return JSONResponse(status_code=404, content={"error": "Not found"})

    static_dir = Path(os.getenv("AGENTTRACE_STATIC_DIR") or DEFAULT_STATIC_DIR)
    if (static_dir / "index.html").is_file():
        app.mount("/", UIStaticFiles(directory=static_dir, html=True), name="ui")
    else:

        @app.get("/", response_class=HTMLResponse, include_in_schema=False)
        async def index():
            return PLACEHOLDER_HTML

    return app


app = create_app()
