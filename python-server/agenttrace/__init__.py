"""AgentTrace — live sequence-diagram tracing for AI agents, MLflow-style.

    import agenttrace
    agenttrace.set_project("support-bot")
    with agenttrace.start_run("triage"):
        agenttrace.log_event(source="Orchestrator", target="LLM", type="llm_call")

Runs go to ./agenttrace.db unless `set_tracking_uri()` /
AGENTTRACE_TRACKING_URI points elsewhere (another SQLAlchemy URL, or an
`agenttrace ui` server over http(s)).
"""

from .tracking._uri import get_tracking_uri, set_tracking_uri
from .tracking.client import AgentTraceClient
from .tracking.fluent import active_run, end_run, get_project, log_event, set_project, start_run, trace
from .tracking.run import ActiveRun

__version__ = "0.2.0"

__all__ = [
    "ActiveRun",
    "AgentTraceClient",
    "active_run",
    "end_run",
    "get_project",
    "get_tracking_uri",
    "log_event",
    "set_project",
    "set_tracking_uri",
    "start_run",
    "trace",
]
