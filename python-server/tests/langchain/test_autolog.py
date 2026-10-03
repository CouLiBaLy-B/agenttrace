import threading
from pathlib import Path

from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableLambda

import agenttrace.langchain
from agenttrace.store.db import init_db
from tests.conftest import read_runs


def _chain():
    model = GenericFakeChatModel(messages=iter([AIMessage(content="hi")]))
    return RunnableLambda(lambda q: {"messages": [model.invoke(q)]}, name="autologged")


def test_autolog_traces_without_explicit_callbacks(tracking_db):
    agenttrace.langchain.autolog()
    try:
        _chain().invoke("hello")
    finally:
        agenttrace.langchain.autolog(disable=True)
    [run] = read_runs(tracking_db)
    assert run["name"] == "autologged"
    assert [e["type"] for e in run["events"]] == ["llm_call", "final_answer"]


def test_autolog_disable_stops_tracing(tracking_db):
    agenttrace.langchain.autolog()
    agenttrace.langchain.autolog()  # idempotent
    agenttrace.langchain.autolog(disable=True)
    _chain().invoke("hello")
    # Nothing was traced, so the tracking DB was never even created.
    assert not Path(tracking_db.removeprefix("sqlite:///")).exists()


def test_autolog_traces_invocations_from_other_threads(tracking_db):
    """Review focus #4: e.g. a FastAPI threadpool worker."""
    agenttrace.langchain.autolog()
    try:
        t = threading.Thread(target=lambda: _chain().invoke("from thread"))
        t.start()
        t.join()
    finally:
        agenttrace.langchain.autolog(disable=True)
    assert len(read_runs(tracking_db)) == 1


def test_autolog_does_not_double_trace_an_explicit_handler(tracking_db):
    init_db(tracking_db)  # so two concurrent runs could both be stored, were both handlers called
    agenttrace.langchain.autolog()
    try:
        explicit = agenttrace.langchain.AgentTraceCallbackHandler(orchestrator="Boss")
        _chain().invoke("hello", config={"callbacks": [explicit]})
    finally:
        agenttrace.langchain.autolog(disable=True)
    [run] = read_runs(tracking_db)
    assert [e["source"] for e in run["events"]] == ["Boss", "Boss"]
