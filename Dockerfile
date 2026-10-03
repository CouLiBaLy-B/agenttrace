# AgentTrace — single image: the Python package (FastAPI API + /ws) serving
# the static dashboard built in the first stage. No Node at runtime.

FROM oven/bun:1.3 AS ui
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build:ui

FROM python:3.12-slim AS app
WORKDIR /app
COPY python-server/ ./python-server/
COPY --from=ui /app/python-server/agenttrace/server/static ./python-server/agenttrace/server/static
RUN pip install --no-cache-dir "./python-server[server,postgres]"
# Run unprivileged; /data is the working dir so a default SQLite file is writable.
RUN useradd --system --uid 10001 --home /data --create-home agenttrace
WORKDIR /data
USER agenttrace
EXPOSE 3000
# Non-loopback host => password mode (accounts + project API keys).
# Configure AGENTTRACE_SECRET and DATABASE_URL via the environment.
CMD ["agenttrace", "ui", "--host", "0.0.0.0", "--port", "3000"]
