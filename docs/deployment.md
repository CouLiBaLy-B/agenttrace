# Deployment

`agenttrace ui` is one Python process: the FastAPI API, the `/ws` live stream
and the dashboard's static files. Deploying it means picking a database, a way
to run the process, and what sits in front of it.

## Docker image

The `Dockerfile` at the root of the repository builds a single image: a Bun
stage builds the dashboard, then a `python:3.12-slim` stage installs
`deepagents-trace[server,postgres]` and runs
`agenttrace ui --host 0.0.0.0 --port 3000` as an unprivileged user (uid 10001),
in `/data`. Since it listens on every interface, it runs in password mode.

```bash
docker build -t agenttrace .
docker run -p 3000:3000 -e AGENTTRACE_SECRET="$(openssl rand -base64 32)" \
  -v agenttrace-data:/data agenttrace
```

Without `DATABASE_URL`, the container uses SQLite at `/data/agenttrace.db`:
keep `/data` on a volume, as above, or the data goes away with the container.
Without `AGENTTRACE_SECRET`, or with a new value, sign-ins reset at every
restart: keep the same secret across runs.

Then sign up in the browser. On the **Integration** page, **Regenerate key**
creates a project's API key and shows it once, and Settings → Demo data →
**Load demo projects** adds the sample projects. `agenttrace demo` doesn't
help here: it fills the local user of `--auth none` mode, which password mode
doesn't show.

## Docker Compose, with PostgreSQL

```bash
cp .env.example .env
# in .env, set AGENTTRACE_SECRET=<the output of: openssl rand -base64 32>
docker compose up --build
```

`docker-compose.yml` runs PostgreSQL 16 (data in the `pgdata` volume) and the
`agenttrace` service on port 3000, connected through
`DATABASE_URL=postgresql+psycopg://...@db:5432/...`, built from
`POSTGRES_DB`, `POSTGRES_USER` and `POSTGRES_PASSWORD` (all `agenttrace` by
default). Compose refuses to start until `AGENTTRACE_SECRET` is set.
PostgreSQL isn't published on the host: add a `ports:` entry to the `db`
service to reach it. `docker compose down -v` deletes the data.

## PostgreSQL without Docker

```bash
pip install 'deepagents-trace[server,postgres]'
export DATABASE_URL=postgresql+psycopg://agenttrace:secret@db:5432/agenttrace
export AGENTTRACE_SECRET="$(openssl rand -base64 32)"
agenttrace db init  # optional: agenttrace ui creates the tables too
agenttrace ui --host 0.0.0.0
```

There are no migrations: missing tables are created, existing ones are left as
they are.

## Sending runs to a deployment

Point the agents at the server, with a project key:

```bash
export AGENTTRACE_TRACKING_URI=https://traces.example.com
export AGENTTRACE_KEY=atr_...
```

Agents can also write to the database directly
(`AGENTTRACE_TRACKING_URI=postgresql+psycopg://...`), but those runs belong to
the local user, which only `--auth none` shows. With a password-mode server,
send them over HTTP.

## Behind a reverse proxy

Terminate TLS in the proxy and forward everything to the server, including the
WebSocket upgrade of `/ws` (the live diagram needs it), keeping the original
`Host` header. With nginx:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ""      close;
}

server {
    listen 443 ssl;
    server_name traces.example.com;
    # ssl_certificate ... ;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
    }
}
```

- **Password mode**: the `/ws` origin check compares the browser's `Origin` with
  the `Host` header the server receives. Forward `Host`, as above, or list the
  public name in `AGENTTRACE_ALLOWED_HOSTS`.
- **`--auth none`**: the server only accepts loopback host names, so list the
  public one: `AGENTTRACE_ALLOWED_HOSTS=traces.example.com`. Anyone who can
  reach the proxy can then read and write traces: put authentication in front
  of it, or use password mode.

## Live updates

The server reads new events from the database every 0.5 seconds, for the runs
that someone is watching. That is why runs written straight to the database by
the SDK, without going through the server, show up live too.
