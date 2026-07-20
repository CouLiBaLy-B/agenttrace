# deepagents-trace (Python server + CLI)

PyPI distribution name: **`deepagents-trace`** (the `agenttrace` name is
already taken on PyPI by an unrelated project — TensorStax's own agent-tracing
tool — so this package is published under a different name; the importable
module, the CLI command, and the product itself are still called
`agenttrace`/AgentTrace).

`pip install deepagents-trace && agenttrace ui` — starts the AgentTrace web
API (and a `/ws` live-stream) with **zero Node/Bun process**, `mlflow ui`-style.
For local development against this checkout: `pip install -e python-server`.

This is **Phase 1 + 3** of the Python migration plan: a FastAPI backend that
is a 1:1 contract port of the Next.js API (`src/app/api/*` in the main repo),
plus the CLI. **Phase 2 is not done yet** — there is no bundled frontend, so
`/` currently serves a placeholder page confirming the API is up; use the API
directly (`/api/*`) or the existing Next.js dashboard against this backend's
data once Phase 2 lands.

## Install & run

```bash
pip install -e python-server
agenttrace ui                      # http://127.0.0.1:3000, SQLite by default (./agenttrace.db)
agenttrace ui --database-url postgresql://user:pass@localhost:5432/agenttrace
agenttrace ui --port 8080 --host 0.0.0.0
```

`agenttrace db init` creates the schema explicitly (also runs automatically
on `agenttrace ui` startup) — schema-push style (`Base.metadata.create_all`),
matching how this repo already runs `prisma db push` rather than migrations.

## What's ported

| Next.js (`src/`) | Python (`agenttrace/server/`) |
| --- | --- |
| `prisma/schema.prisma` | `models.py` (SQLAlchemy) — same `User/Project/Run/Event/ApiKey` shape |
| `src/lib/auth.ts` (NextAuth) | `routes/auth.py` + `security.py` — signed-cookie session (not NextAuth wire-compatible) |
| `src/lib/api-auth.ts`, `src/lib/keys.ts` | `deps.py`, `security.py` — same `atr_<32 hex>` key format/hash |
| `src/app/api/**/route.ts` | `routes/{projects,runs,events,keys,stats}.py` — same JSON shapes |
| `mini-services/socket-service` (Socket.IO) | `realtime.py` (`/ws`, plain JSON protocol — see its docstring) |

The `POST /api/events` contract (the one `integrations/agenttrace-langchain`
depends on) is unchanged: same fields, same `atr_` key auth, same event
types.

## Tests

```bash
pip install -e "python-server[dev]"
pytest python-server/tests
```

## Publishing to PyPI

Packaging is ready and verified (`python -m build` + `twine check dist/*`
both pass; the built wheel installs and runs standalone in a clean venv).
`.github/workflows/publish-pypi.yml` builds and publishes on every GitHub
Release, using **PyPI Trusted Publishing (OIDC)** — no API token stored as a
GitHub secret. What's left requires your PyPI account, so it can't be done
from here:

1. Create a PyPI account (https://pypi.org/account/register/) if you don't
   have one, and enable 2FA (PyPI requires it).
2. Since `deepagents-trace` doesn't exist on PyPI yet, register it as a
   **pending publisher** (Publishing → Trusted publishers →
   "Add a pending publisher" at https://pypi.org/manage/account/publishing/):
   - PyPI project name: `deepagents-trace`
   - Owner: `CouLiBaLy-B`, Repository: `agenttrace`
   - Workflow filename: `publish-pypi.yml`
   - Environment name: `pypi`
3. In the GitHub repo settings, create an environment named `pypi` (Settings
   → Environments) — optionally with a required reviewer, so publishing needs
   manual approval.
4. Bump `version` in `pyproject.toml`, commit, then create a GitHub Release
   (tag `v0.1.0`) — the workflow builds and publishes automatically. First
   publish finalizes the pending publisher into a real one.
5. (Optional but recommended) do a dry run against TestPyPI first
   (https://test.pypi.org) with the same trusted-publisher flow before the
   real release.

## Known gaps vs. the Next.js backend (tracked for later phases)

- No frontend bundle yet (Phase 2).
- No demo-account seeding on signup (the Next.js version seeds 3 sample
  projects — intentionally skipped here to keep this phase scoped to the API
  contract).
- Realtime wire protocol is plain JSON over `/ws`, not the Socket.IO
  protocol — the current React frontend's `socket.io-client` won't talk to
  it until Phase 2 adapts it.
