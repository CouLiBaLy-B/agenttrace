# deepagents-trace (deprecated: renamed to lanetrace)

> **Deprecated.** AgentTrace, published as `deepagents-trace` and imported
> as `agenttrace`, is now **LaneTrace**: `pip install lanetrace`,
> `import lanetrace`, `lanetrace ui`. This package only keeps 0.2 code and
> scripts working while you migrate.

`deepagents-trace` 0.3.0 installs `lanetrace` 0.3 and provides:

- `import agenttrace` (and every `agenttrace.<submodule>`, such as
  `agenttrace.langchain`, `agenttrace.tracking.async_http`,
  `agenttrace.server.app`) as aliases of the matching `lanetrace` modules:
  the same module objects, so classes and state are shared. Importing it
  emits one `DeprecationWarning`.
- The `agenttrace` command: it runs `lanetrace` with the same options and
  prints a one-line deprecation note to stderr.
- The 0.2 extras, each mapped to the same `lanetrace` extra:
  `deepagents-trace[server]` installs `lanetrace[server]`, and likewise for
  `langchain`, `postgres`, `e2e` and `dev`.

> **Don't install it next to the unrelated `agenttrace` project on PyPI.**
> `pip install agenttrace` is someone else's package, and it ships a
> top-level `agenttrace` module too: with both installed, one overwrites the
> other's files. If you have it, uninstall it, or move to `import lanetrace`
> and drop this package.

The 0.2 class names (`AgentTraceClient`, `AgentTraceMiddleware`,
`AgentTraceCallbackHandler`, `AsyncAgentTraceCallbackHandler`) are aliases
in `lanetrace` itself, so they work through either import.

## Migrating

| 0.2 (`deepagents-trace`) | 0.3 (`lanetrace`) |
| --- | --- |
| `pip install 'deepagents-trace[server]'` | `pip install 'lanetrace[server]'` |
| `import agenttrace` | `import lanetrace` |
| `agenttrace ui` | `lanetrace ui` |
| `AGENTTRACE_TRACKING_URI`, `AGENTTRACE_KEY`, ... | `LANETRACE_TRACKING_URI`, `LANETRACE_KEY`, ... |
| `./agenttrace.db` | `./lanetrace.db` |
| `agenttrace.langchain.AsyncAgentTraceCallbackHandler` | `lanetrace.langchain.AsyncLaneTraceCallbackHandler` |

The `AGENTTRACE_*` variables and an existing `./agenttrace.db` keep working
in `lanetrace` (with a deprecation line in the log). See
[Upgrading from 0.2](https://coulibaly-b.github.io/lanetrace/upgrading/).

## Tests

```bash
pip install -e ../../python-server -e ".[dev]"
pytest tests
```
