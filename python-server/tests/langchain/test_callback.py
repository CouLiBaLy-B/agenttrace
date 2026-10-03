import threading

import pytest
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableLambda
from langchain_core.tools import tool

import agenttrace
from agenttrace.langchain import AgentTraceCallbackHandler
from tests.conftest import read_runs


@tool
def add(a: int, b: int) -> int:
    """Add two integers."""
    return a + b


@tool
def explode(x: int) -> int:
    """Always fails."""
    raise ValueError("kaboom")


def _model():
    return GenericFakeChatModel(messages=iter([AIMessage(content="the answer is 3")]))


def _pipeline(model):
    def run(question: str) -> dict:
        total = add.invoke({"a": 1, "b": 2})
        reply = model.invoke(f"{question} {total}")
        return {"messages": [reply]}

    return RunnableLambda(run, name="pipeline")


def test_handler_maps_a_root_invocation_to_one_run(tracking_db):
    handler = AgentTraceCallbackHandler()
    _pipeline(_model()).invoke("sum?", config={"callbacks": [handler]})
    [run] = read_runs(tracking_db)
    assert run["name"] == "pipeline" and run["status"] == "completed"
    types = [(e["type"], e["source"], e["target"]) for e in run["events"]]
    assert types[0] == ("tool_call", "Orchestrator", "add")
    assert types[1] == ("tool_result", "add", "Orchestrator")
    assert types[2][0] == "llm_call" and types[2][1] == "Orchestrator"
    assert types[3] == ("final_answer", "Orchestrator", "User")
    assert run["events"][3]["payload"]["answer"] == "the answer is 3"


def test_tool_error_is_recorded_and_root_failure_fails_run(tracking_db):
    chain = RunnableLambda(lambda x: explode.invoke({"x": x}), name="failing")
    with pytest.raises(ValueError):
        chain.invoke(1, config={"callbacks": [AgentTraceCallbackHandler()]})
    [run] = read_runs(tracking_db)
    assert run["status"] == "failed"
    assert [e["type"] for e in run["events"]] == ["tool_call", "error"]


def test_reuses_active_fluent_run_without_closing_it(tracking_db):
    with agenttrace.start_run("outer"):
        _pipeline(_model()).invoke("sum?", config={"callbacks": [AgentTraceCallbackHandler()]})
        agenttrace.log_event(source="me", target="you", type="tool_call")
    [run] = read_runs(tracking_db)
    assert run["name"] == "outer"
    assert [e["type"] for e in run["events"]][-1] == "tool_call"  # still open after the chain ended


def test_handoff_tool_emits_handoff(tracking_db):
    @tool
    def handoff_to_researcher(to: str) -> str:
        """Delegate."""
        return "ok"

    chain = RunnableLambda(lambda x: handoff_to_researcher.invoke({"to": "Researcher"}), name="delegating")
    chain.invoke(None, config={"callbacks": [AgentTraceCallbackHandler()]})
    events = read_runs(tracking_db)[0]["events"]
    assert ("handoff", "Researcher") in [(e["type"], e["target"]) for e in events]


def test_handler_errors_never_propagate(tracking_db, monkeypatch):
    handler = AgentTraceCallbackHandler()
    monkeypatch.setattr(handler, "_root_state", lambda *a, **k: 1 / 0)
    assert _pipeline(_model()).invoke("sum?", config={"callbacks": [handler]})["messages"]


def test_never_joins_the_implicit_fluent_run(tracking_db):
    agenttrace.log_event(source="me", target="you", type="tool_call")  # creates the implicit run
    handler = AgentTraceCallbackHandler()
    RunnableLambda(lambda x: add.invoke({"a": 1, "b": 2}), name="first").invoke(None, config={"callbacks": [handler]})
    RunnableLambda(lambda x: add.invoke({"a": 3, "b": 4}), name="second").invoke(None, config={"callbacks": [handler]})
    agenttrace.end_run()
    runs = {r["name"]: [e["type"] for e in r["events"]] for r in read_runs(tracking_db)}
    assert runs.pop("first") == runs.pop("second") == ["tool_call", "tool_result", "final_answer"]
    [implicit] = runs.values()
    assert implicit == ["tool_call"]


def test_concurrent_roots_on_one_handler_stay_separate(tracking_db):
    handler = AgentTraceCallbackHandler()
    barrier = threading.Barrier(2, timeout=10)

    def chain(name, a):
        def run(_):
            barrier.wait()
            result = add.invoke({"a": a, "b": 0})
            barrier.wait()
            return result

        return RunnableLambda(run, name=name)

    threads = [
        threading.Thread(target=lambda n=n, a=a: chain(n, a).invoke(None, config={"callbacks": [handler]}))
        for n, a in (("left", 1), ("right", 2))
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    runs = {r["name"]: r["events"] for r in read_runs(tracking_db)}
    assert sorted(runs) == ["left", "right"]
    for name, a in (("left", 1), ("right", 2)):
        assert [e["type"] for e in runs[name]] == ["tool_call", "tool_result", "final_answer"]
        assert runs[name][2]["payload"]["answer"] == str(a)
