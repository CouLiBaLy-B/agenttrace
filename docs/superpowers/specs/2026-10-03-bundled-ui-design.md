# Bundled UI (sub-project D) — design

Date: 2026-10-03
Status: approved in conversation, pending written review
Builds on: `2026-10-03-mlflow-like-sdk-design.md` (sub-projects A/B/C,
branch `feat/mlflow-like-sdk`, PR #5). This work branches from it
(`feat/bundled-ui`).

## Goal

`pip install 'deepagents-trace[server]' && agenttrace ui` opens the real
AgentTrace dashboard — live sequence diagram, projects, runs, integration,
settings — with no Node/Bun process at runtime. FastAPI becomes the only
backend; the Next.js server backend is removed.

Success criteria:

1. A wheel built by CI contains the UI bundle; installed in a clean venv,
   `agenttrace demo && agenttrace ui` serves the dashboard at `/` with the
   three demo projects visible.
2. With the UI open on a running run, an event logged through the SDK
   (`agenttrace.log_event` against the same database) appears in the
   diagram without a page reload.
3. `agenttrace ui` in `--auth none` shows no login screen; with
   `--auth password` the login/signup screen works against FastAPI.

## Decisions (from the conversation)

- **Retire the Next.js backend.** Next.js stays only as the build tool of a
  static bundle. Prisma, NextAuth, the Socket.IO mini-service, Caddy and the
  two-image Docker setup are removed; Docker runs the Python package.
- **Demo data via CLI.** The three demo projects are ported to Python and
  exposed as `agenttrace demo` and `POST /api/seed` (Settings button). No
  demo account, no demo credentials baked into the bundle, no automatic
  seeding on signup.
- **Build approach:** Next.js `output: "export"` (the app is already a
  client-rendered single page). Rejected: migrating to Vite (rewrite with no
  functional gain); proxying a Next dev server (contradicts "no Node at
  runtime").
- The bundle is **not committed**; it is built in CI and shipped as package
  data in the wheel.
- Look and views are unchanged. No deep links (the app keeps its in-memory
  view switching).

## Frontend changes

### Session (replaces `next-auth/react`)

`src/lib/session.ts`:

- `useSession()` — TanStack Query on `GET /api/auth/session`; returns
  `{ status: "loading" | "authenticated" | "unauthenticated", user, authMode }`.
- `signIn(email, password)`, `signUp(email, password, name?)`,
  `signOut()` — JSON `POST /api/auth/{signin,signup,signout}` through the
  existing `api()` helper; errors surface the server's `error` message in
  the toasts.
- After sign-in/up/out: invalidate the session query (no
  `window.location.reload()`).

Consumers updated: `components/providers.tsx` (drop `SessionProvider`),
`app/page.tsx` (gate), `components/auth/auth-screen.tsx` (forms; demo
button and `NEXT_PUBLIC_DEMO_*` removed), `components/layout/sidebar.tsx`,
`components/views/settings-view.tsx`.

`authMode === "none"`: the auth screen is never shown; the sign-out button
and the Account section are hidden; Settings shows "Local mode — no
account".

### Live updates (replaces `socket.io-client`)

`src/lib/live.ts` — a small native WebSocket client:

- URL: `NEXT_PUBLIC_AGENTTRACE_WS_URL` if set (dev only), else
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`.
- `subscribeRun(runId, handlers)` → unsubscribe function. Sends
  `{"action":"subscribe","runId"}`; dispatches `subscribed`, `event`
  (`data`), `run:update` (`patch`), `error` messages to handlers.
- Reconnects with exponential backoff (1 s, 2 s, 4 s … capped at 15 s,
  unlimited while subscribed) and re-subscribes; exposes `connected`.
- On every `subscribed`, the consumer refetches `GET /api/runs/{id}` and
  merges events by id — closes the gap between the initial REST load and
  the subscription (the server streams only events with `seq` > the cursor
  taken at subscribe time).
- On `error` ("Run not found", "Too many subscriptions"): stop showing
  "listening", keep the 5 s polling fallback.

Consumer: `components/sequence-diagram/sequence-diagram.tsx` (only one).
Replay stays client-side (unchanged); the server's `replay` actions are
unused.

### Integration page

- Base URL from `window.location.origin` (no hard-coded
  `localhost:3000`).
- `authMode === "none"`: snippets show (a) the Python SDK
  (`agenttrace.set_tracking_uri(origin)`, `set_project(name)`,
  `agenttrace.langchain.autolog()`), (b) raw HTTP without a key, with
  `"project": "<name>"`. Key management is hidden; the intro text no longer
  says a key is required.
- `authMode === "password"`: current key flow; snippets use the SDK with
  `AGENTTRACE_KEY` plus raw HTTP with `Authorization: Bearer`.
- DeepAgents tab uses `pip install 'deepagents-trace[langchain]'` and
  `agenttrace.langchain` (middleware or autolog).
- Endpoint reference lists only `POST /api/events` for ingestion (session
  routes are not part of the ingestion API).

### Cleanup

- `next/font/google` → `geist` npm package (`geist/font/sans`,
  `geist/font/mono`): offline, reproducible builds.
- Favicon → `public/logo.svg`.
- Labels: "socket.io :3003" / "next-auth · prisma" are dropped; the footer
  shows "live · /ws"; the hard-coded "v1.0.0" in Settings is replaced by
  the `version` field of `GET /api/auth/session` (see backend).
- `next.config.ts`: `output: "export"` and `images.unoptimized: true` for
  production builds; `rewrites` (`/api/*` → `http://127.0.0.1:3000`) only
  in development; `typescript.ignoreBuildErrors` removed (the build must
  type-check). `allowedDevOrigins` sandbox hosts removed.
- `package.json`: name `agenttrace-ui`; scripts `dev` (next dev -p 3001),
  `build` (static export), `build:ui` (build + copy `out/` →
  `python-server/agenttrace/server/static/`), `lint`, `typecheck`.
  Removed deps: `next-auth`, `prisma`, `@prisma/*`, `pg`, `socket.io`,
  `socket.io-client`, `bcryptjs`, `sharp`, `dotenv`, `next-themes` (sonner
  gets `theme="dark"` directly), and any dependency left unused after the
  removals.

### Deleted

`src/app/api/**`, `src/lib/{db,auth,session,api-auth,keys,seed,socket-client}.ts`
(old server-side `session.ts` replaced by the new client one),
`src/lib/db.sqlite.ts.example`, `src/types/next-auth.d.ts`, `prisma/`,
`prisma.config.ts`, `mini-services/`, `Caddyfile`, `db/custom.db`,
`.scripts/`, `.env.example` entries for NextAuth/Postgres/socket (replaced
by the Python server's variables).

## Backend changes

- `GET /api/runs/{id}`: response `run` gains
  `project: {id, name, userId}` (restores the contract the UI was built
  for).
- `GET /api/auth/session`: response gains `authMode` (`"none"` |
  `"password"`) and `version` (`agenttrace.__version__`), in both modes and
  for anonymous callers.
- Demo seed: `agenttrace/store/demo.py` ports `src/lib/seed.ts` (three
  projects — Customer Support Agent, Research Assistant, Code Review Bot —
  with their runs and events, same content) as
  `seed_demo(db, user) -> int` (number of projects created; 0 if the user
  already has projects).
  - `POST /api/seed` (session user; local user in `none` mode) →
    `{"seeded": n}`.
  - `agenttrace demo [--database-url URL]` seeds the `local` user's
    projects in the target database and prints what it did.
- Static UI: `agenttrace/server/static/` (git-ignored, package data). In
  `create_app`, after all API routers and `/ws`, mount
  `StaticFiles(directory=static, html=True)` at `/` when
  `static/index.html` exists; otherwise keep the placeholder page, whose
  text now says how to build the UI (`bun run build:ui`) or install a
  released wheel. Unknown paths under `/api/` still return JSON 404s.
- `LocalGuard` and the `/ws` checks apply unchanged (same-origin serving
  satisfies them).

## Packaging and build

- `python-server/pyproject.toml`: `[tool.setuptools.package-data]`
  includes `agenttrace/server/static/**`. A new extra `postgres =
  ["psycopg[binary]>=3.1"]` for Docker/production Postgres.
- CI (`.github/workflows/ci.yml`): the existing Node job becomes
  `ui`: `bun install`, `bun run lint`, `bun run typecheck`,
  `bun run build:ui`, upload `python-server/agenttrace/server/static` as an
  artifact. The `python` job downloads it before installing, so the Python
  tests that check UI serving run against the real bundle. The Docker job
  builds the new single image and smoke-tests `GET /` and
  `GET /api/auth/session`.
- `publish-pypi.yml`: builds the UI (bun) before `python -m build`, and
  fails if `agenttrace/server/static/index.html` is missing from the wheel.
- `Dockerfile`: stage 1 `oven/bun` builds the UI; stage 2
  `python:3.12-slim` copies the bundle into `python-server/`, installs
  `.[server,postgres]`, runs
  `agenttrace ui --host 0.0.0.0 --port 3000` (password mode by default on
  a non-loopback host). `AGENTTRACE_SECRET` and `DATABASE_URL` from env.
- `docker-compose.yml`: services `db` (Postgres, unchanged) and
  `agenttrace` (the image above); socket service removed.

### Development loop

- `agenttrace ui --auth none` on :3000 (backend) + `bun run dev` on :3001
  with `NEXT_PUBLIC_AGENTTRACE_WS_URL=ws://localhost:3000/ws`. REST goes
  through Next rewrites; the WebSocket connects directly (LocalGuard allows
  `localhost` origins in `none` mode). Documented in README.

## Error handling

| Situation | Behaviour |
| --- | --- |
| Bundle missing (source install) | placeholder page with build instructions; API works |
| `/ws` closes or errors | backoff reconnect + re-subscribe; 5 s REST polling continues |
| `/ws` `error` message | "listening" indicator off, polling continues |
| Session expired (401 on an API call) | session query invalidated → auth screen (password mode) |
| `POST /api/seed` when projects exist | `{"seeded": 0}`, toast "Demo projects already present" |

## Testing

- Python:
  - `GET /api/runs/{id}` includes `project`.
  - `/api/auth/session` includes `authMode` and `version` (none, password,
    anonymous).
  - `seed_demo`: creates 3 projects with runs/events matching the TS seed
    counts; idempotent; `POST /api/seed`; `agenttrace demo` CLI.
  - UI serving: with a fake bundle in a temp static dir (`index.html` +
    `_next/static/x.js`), `/` and `/_next/static/x.js` are served and
    `/api/unknown` is a JSON 404; without a bundle, `/` is the placeholder.
  - Wheel check (CI): built wheel contains `agenttrace/server/static/index.html`.
- Frontend: `bun run typecheck` (no `ignoreBuildErrors`) and
  `bun run lint` must pass; static build succeeds with network disabled
  after `bun install` (fonts local).
- End-to-end (CI job `e2e`, Playwright, chromium): install the wheel built
  with the bundle, `agenttrace demo`, start `agenttrace ui`; check the
  dashboard lists the 3 demo projects; open a project, create a run
  (status running), open it; from Python, `AgentTraceClient(...).log_event`
  on that run; assert the new arrow/event label appears within 5 s; repeat
  the login flow with `--auth password` (signup → dashboard → sign out →
  auth screen).

## Out of scope

- URL routing / deep links.
- New UI features or redesign.
- Alembic migrations.
- Data migration from the old Prisma database (fresh FastAPI databases
  only; documented in the upgrade notes).
