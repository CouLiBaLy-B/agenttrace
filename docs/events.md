# Event contract

The client talks to the dashboard over a single endpoint. The contract is
stable and language-agnostic — you can emit events from any language, not just
via `agenttrace-langchain`.

## `POST /api/events`

Authenticated with a project API key: `Authorization: Bearer atr_...`.

**Create a run** (first call) — omit `runId`; the server returns the new id:

```json
{ "runId": null, "name": "research run" }
```

```json
{ "runId": "run_abc123", "event": null }
```

**Emit an event** — reference the `runId`:

```json
{
  "runId": "run_abc123",
  "source": "Orchestrator",
  "target": "web_search",
  "type": "tool_call",
  "label": "web_search({\"q\": \"rust\"})",
  "payload": { "args": { "q": "rust" } },
  "durationMs": 120,
  "status": "ok"
}
```

**End a run**:

```json
{ "runId": "run_abc123", "endRun": "completed" }
```

## Event types

| `type` | Typical arrow | Notes |
| --- | --- | --- |
| `llm_call` | Orchestrator → LLM | payload: `input` (system + messages), `output_preview`, `tokens` |
| `tool_call` | Orchestrator → tool | payload: `args` (+ optional `server`) |
| `tool_result` | tool → Orchestrator | payload: `result`; `durationMs` |
| `handoff` | Orchestrator → Sub-agent (or User → Orchestrator) | delegation / the opening user message |
| `error` | tool/LLM → Orchestrator | `status: "error"` |
| `final_answer` | Orchestrator → User | payload: `answer` |

`status` is one of `ok`, `error`, `pending`. `durationMs` is optional.

## Participant kinds

The dashboard infers each participant's kind from **how it's used in the
event stream**, not its name:

- target of an `llm_call` → **llm**
- target of a `tool_call` / source of a `tool_result` → **tool**
- a non-user `handoff` target → **sub-agent**
- `User` / `Orchestrator` by name → **user** / **orchestrator**

This is why a model id like `zai.glm-5` types as an LLM and a tool named
`iam_resolve_user_scope` types as a tool (not a user).

## Reliability guarantees (client side)

`agenttrace-langchain` wraps this contract so it never affects your agent:
non-blocking emission (background queue), never fatal (first failure disables
the run with one warning), and bounded payloads (truncation). See the
[middleware](integration-middleware.md) and [callback handler](integration-callback.md).
