"""LaneTrace — live sequence-diagram tracing for AI agents, MLflow-style.

    import lanetrace
    lanetrace.set_project("support-bot")
    with lanetrace.start_run("triage"):
        lanetrace.log_event(source="Orchestrator", target="LLM", type="llm_call")

Runs go to ./lanetrace.db unless `set_tracking_uri()` /
LANETRACE_TRACKING_URI points elsewhere (another SQLAlchemy URL, or an
`lanetrace ui` server over http(s)).
"""

from .tracking._uri import get_tracking_uri, set_tracking_uri
from .tracking.client import AgentTraceClient, LaneTraceClient  # AgentTraceClient: deprecated alias
from .tracking.fluent import active_run, end_run, get_project, log_event, set_project, start_run, trace
from .tracking.run import ActiveRun

__version__ = "0.3.0"

__all__ = [
    "ActiveRun",
    "AgentTraceClient",
    "LaneTraceClient",
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
