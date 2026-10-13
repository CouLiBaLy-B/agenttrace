# Event contract

Agents send runs to `agenttrace ui` through one endpoint, `POST /api/events`,
from any language. The Python SDK uses it when the tracking URI is
`http(s)://`; when it writes straight to the database (the default), it stores
the same runs and events.

## Authentication

| Server | Request |
| --- | --- |
| `--auth password` | `Authorization: Bearer atr_...`, a project key from the **Integration** page; the run goes to that key's project. No key: `401 {"error": "Missing or invalid API key"}`; an unknown key: `401 {"error": "Invalid API key"}`. |
| `--auth none` | No `Authorization` header: the body names the project when it creates a run. A header that is sent anyway is checked as a key. The server only accepts loopback `Host` and `Origin` names, plus `AGENTTRACE_ALLOWED_HOSTS`; others get `403 {"error": "Host not allowed"}` or `"Origin not allowed"`. |

## Create a run

```json
{"runId": null, "name": "research run", "project": "support-bot"}
```

`project` is only read without a key: that project is created if it doesn't
exist yet. `name` defaults to `Untitled run`. The answer is
`201 {"runId": "<run id>", "event": null}`. Without a key and without
`project`: `400 {"error": "project is required when no API key is sent"}`.

## Add an event

```json
{
  "runId": "<run id>",
  "source": "Orchestrator",
  "target": "web_search",
  "type": "tool_call",
  "label": "web_search(rust web frameworks)",
  "payload": {"args": {"query": "rust web frameworks"}},
  "durationMs": 720,
  "status": "ok"
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `runId` | yes | the id returned when the run was created |
| `source`, `target` | yes | participant names: the diagram draws one lifeline per name |
| `type` | yes | `llm_call`, `tool_call`, `tool_result`, `handoff`, `error` or `final_answer` |
| `label` | no | the text on the arrow |
| `payload` | no | any JSON, shown in the event's detail panel (default `{}`) |
| `durationMs` | no | an integer |
| `status` | no | `ok`, `error` or `pending` (not checked by the server); default `error` for an `error` event, else `ok` |

The server numbers the events of a run (`seq`: 0, 1, 2…) and timestamps them.
The answer is `201 {"runId": "<run id>", "event": {...}}`, where the event has
`id`, `runId`, `timestamp`, `seq`, `source`, `target`, `type`, `label`,
`payload`, `durationMs` and `status`.

| Error | Answer |
| --- | --- |
| `source`, `target` or `type` missing | `400 {"error": "source, target, type are required"}` |
| unknown `type` | `400 {"error": "type must be one of: error, final_answer, handoff, llm_call, tool_call, tool_result"}` |
| unknown run, or a run of another project | `404 {"error": "Run not found in this project"}` |
| a body that isn't a JSON object | `400 {"error": "Invalid JSON body"}` |

## End a run

```json
{"runId": "<run id>", "endRun": "completed"}
```

`"failed"` ends the run `failed`; any other value ends it `completed`. The
answer is `200 {"runId": "<run id>", "closed": true, "status": "completed"}`. A
body with a non-empty `endRun` only ends the run, whatever else it holds; an
empty, `false` or `null` `endRun` is ignored, and the body is read as an event.
A run that is never ended stays `running`.

## Event types

| `type` | Usual arrow | Payload sent by the SDK |
| --- | --- | --- |
| `llm_call` | agent → model | `output_preview`, `tokens`; the middleware and the async handler also send `input` (system prompt and messages), autolog doesn't |
| `tool_call` | agent → tool | `args`; `@agenttrace.trace` adds `kwargs`, and the async handler `server` (with `tool_server=`) |
| `tool_result` | tool → agent | `result` (and `server`); a sub-agent returning, in the async handler: `status` |
| `handoff` | User → Orchestrator, Orchestrator → sub-agent, or Orchestrator → User | the user's `message`; a hand-off's `task`; an approval request's `actionRequests` (status `pending`) |
| `error` | tool or model → agent | `error` (the exception's class) and `message`; a run-level failure (`on_error()`) sends the message alone, as `error`; a failed sub-agent, `status` and `error` |
| `final_answer` | Orchestrator → User | `answer` |

## With curl

Against `agenttrace ui` on localhost (`--auth none`):

```bash
url=http://127.0.0.1:3000/api/events
post() { curl -s "$url" -H 'Content-Type: application/json' -d "$1"; echo; }

run=$(post '{"runId": null, "name": "curl run", "project": "demo"}' \
  | python3 -c 'import json, sys; print(json.load(sys.stdin)["runId"])')
post '{"runId": "'"$run"'", "source": "Orchestrator", "target": "LLM",
       "type": "llm_call", "label": "plan", "durationMs": 420}'
post '{"runId": "'"$run"'", "endRun": "completed"}'
```

For a server in password mode, add `-H "Authorization: Bearer $AGENTTRACE_KEY"`
to `post` (the key then decides the project).

## Reading runs back

The dashboard reads runs through the same server: `GET /api/runs/recent`
(`?limit=` up to 50, default 12, and `&projectId=`) lists the latest runs, and
`GET /api/runs/<run id>` returns one run with its events. In `--auth none`
mode they need nothing else; in password mode they need the session cookie
that signing in sets.

## Live stream: `/ws`

The browser follows runs over a WebSocket at `/ws`, with plain JSON messages:

| Client sends | Server sends |
| --- | --- |
| `{"action": "subscribe", "runId": "..."}` | `{"type": "subscribed", "runId": "..."}`, then `{"type": "event", "data": {...}}` for each new event, and `{"type": "run:update", "runId": "...", "patch": {"status": ..., "endedAt": ...}}` when the run ends |
| `{"action": "unsubscribe", "runId": "..."}` | |
| `{"action": "replay", "runId": "...", "events": [...], "speed": 1}` | `{"type": "replay:event", "data": {...}}` for each event, paced by their timestamps divided by `speed` (all at once for `0`), then `{"type": "replay:done", "runId": "..."}` |
| `{"action": "replay:stop", "runId": "..."}` | |

An unknown run, or in password mode another user's run, gets
`{"type": "error", "runId": "...", "error": "Run not found"}`; a connection can
follow up to 50 runs. New events are read from the database every 0.5 seconds,
so events written by the SDK straight to the database stream too.

In password mode, the connection needs the session cookie, and a browser's
`Origin` must match the host (or be listed in `AGENTTRACE_ALLOWED_HOSTS`);
otherwise it is closed with code 1008. In `--auth none` mode, the API's `Host`
and `Origin` check applies.
