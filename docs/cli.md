# CLI

`deepagents-trace` installs the `agenttrace` command. `agenttrace --version`
prints the installed version and `agenttrace --help` lists the commands.

## `agenttrace ui`

Serves the API, the `/ws` live stream and the dashboard.

```bash
agenttrace ui [--host 127.0.0.1] [--port 3000] \
              [--database-url URL] [--auth none|password]
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--host` | `127.0.0.1` | the address to listen on; `0.0.0.0` listens on every interface |
| `--port` | `3000` | the port |
| `--database-url` | `DATABASE_URL`, else `sqlite:///./agenttrace.db` | the SQLAlchemy URL of the database to serve |
| `--auth` | `AGENTTRACE_AUTH`, else `none` on a loopback host (`127.0.0.1`, `localhost`, `::1`) and `password` on any other | the auth mode, see below |

It needs the `server` extra. It first prints a banner: the version, the
dashboard URL (`localhost` when it listens on `0.0.0.0` or `::`), the auth
mode, the database, with its password replaced by `***` (and the absolute path
of a relative SQLite file), the `AGENTTRACE_TRACKING_URI` line for your agents
(plus `AGENTTRACE_KEY` in password mode), and the docs URL. Then the server
starts, and creates the tables that don't exist yet. The banner is plain text
when the output isn't a terminal or when `NO_COLOR` is set, which also turns
off the colours of the server's log. Stop the server with Ctrl+C.

### Auth modes

**`none`**: no login and no API key. Everything belongs to a single local user,
the one the SDK writes as when it writes to the database directly. The server
only accepts loopback names in the `Host` and `Origin` headers, a guard against
DNS rebinding and cross-site requests; `AGENTTRACE_ALLOWED_HOSTS=name1,name2`
adds names, for example behind a reverse proxy. On a host other than loopback,
`agenttrace ui` warns that anyone who can reach the port can read and write
traces.

**`password`**: accounts (sign up in the browser) and `atr_...` project keys for
sending events; the `/ws` live stream needs the session cookie. Set
`AGENTTRACE_SECRET` to sign the session cookies: without it, a random secret is
used, sign-ins don't survive a restart, and `agenttrace ui` says so.

## `agenttrace demo`

```bash
agenttrace demo [--database-url URL]
```

Loads three demo projects (Customer Support Agent, Research Assistant, Code
Review Bot) with their runs, for the local user that `--auth none` shows. It
does nothing if that user already has projects. The database is
`--database-url`, else `DATABASE_URL`, else `./agenttrace.db`. It needs the
`server` extra. In password mode, a signed-in user loads the same projects from
Settings → Demo data → **Load demo projects**.

## `agenttrace db init`

```bash
agenttrace db init [--database-url URL]
```

Creates the tables that don't exist yet. There are no migrations: the schema is
created as a whole (SQLAlchemy's `create_all`). `agenttrace ui` does the same
at startup, so `db init` is for preparing a database ahead of time; it works
without the `server` extra.

## Environment variables

| Variable | Read by | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | `ui`, `demo`, `db init` | the database, when `--database-url` isn't given (default `sqlite:///./agenttrace.db`) |
| `AGENTTRACE_AUTH` | `ui` | `none` or `password`, when `--auth` isn't given |
| `AGENTTRACE_SECRET` | the server, in password mode | the secret that signs session cookies |
| `AGENTTRACE_ALLOWED_HOSTS` | the server | comma-separated host names accepted besides loopback: for `Host` and `Origin` in `--auth none` mode, and for the `/ws` origin check in password mode |
| `AGENTTRACE_STATIC_DIR` | the server | serve the dashboard from this directory instead of the bundled one |
| `NO_COLOR` | `ui` | plain-text banner and log |
| `AGENTTRACE_TRACKING_URI` | the SDK | where runs go, see [tracking URIs](mlflow.md#tracking-uris) |
| `AGENTTRACE_PROJECT` | the SDK | the default project (else `Default`) |
| `AGENTTRACE_KEY` | the SDK | the `atr_...` project key sent to a password-mode server |
| `AGENTTRACE_URL` | the SDK | the pre-0.2 ingestion URL (`http://host:port/api/events`), used when `AGENTTRACE_TRACKING_URI` is unset |
