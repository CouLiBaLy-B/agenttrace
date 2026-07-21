"""FastAPI application factory.

Mounts the REST API (1:1 contract with the Next.js backend's `src/app/api/*`
routes) and a `/ws` WebSocket replacing the Socket.IO mini-service. The
static frontend bundle (Phase 2 — the decoupled React UI, built via
`bun run build` with `output: "export"` and copied into `server/static/`) is
served from `/` when present; otherwise `/` falls back to a placeholder page
confirming the API is up.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .db import init_db
from .realtime import manager
from .routes import auth, events, keys, projects, runs, seed, stats

STATIC_DIR = Path(__file__).resolve().parent / "static"

PLACEHOLDER_HTML = """<!doctype html>
<html><head><title>AgentTrace</title></head>
<body style="font-family: system-ui; padding: 2rem;">
<h1>AgentTrace API is running</h1>
<p>The Python backend (FastAPI) is up, but no frontend bundle is present in
this install (<code>server/static/</code> is empty) — see
python-server/README.md for how to build one.</p>
<p>Try the API directly, e.g. <code>GET /api/stats</code> (requires a session
cookie) or <code>POST /api/events</code> (requires a project API key).</p>
</body></html>"""


@asynccontextmanager
async def _lifespan(app: FastAPI):
    init_db()
    manager.bind_loop(asyncio.get_running_loop())
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="AgentTrace", lifespan=_lifespan)

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

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket):
        await manager.connect(websocket)
        try:
            while True:
                message = await websocket.receive_json()
                action = message.get("action")
                run_id = message.get("runId")
                if action == "subscribe" and run_id:
                    await manager.subscribe(websocket, run_id)
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

    if STATIC_DIR.is_dir() and (STATIC_DIR / "index.html").exists():
        # Mounted last so it never shadows the API routes above (Starlette
        # tries routes in registration order). `html=True` serves index.html
        # for "/"; there's no client-side URL routing to fall back for
        # (the app's internal navigation is a Zustand store, not real routes).
        app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
    else:
        @app.get("/", response_class=HTMLResponse)
        async def index():
            return PLACEHOLDER_HTML

    return app


app = create_app()
