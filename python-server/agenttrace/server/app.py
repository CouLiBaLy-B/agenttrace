"""FastAPI application factory.

Mounts the REST API (1:1 contract with the Next.js backend's `src/app/api/*`
routes) and a `/ws` WebSocket replacing the Socket.IO mini-service. Serving
the actual frontend bundle is Phase 2 (frontend decoupling, not done yet) —
for now `/` serves a minimal placeholder page confirming the API is up.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse

from .db import init_db
from .realtime import manager
from .routes import auth, events, keys, projects, runs, stats

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

    @app.get("/", response_class=HTMLResponse)
    async def index():
        return PLACEHOLDER_HTML

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

    return app


app = create_app()
