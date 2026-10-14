import pytest

from agenttrace import AgentTraceClient
from tests.conftest import read_runs


def test_explicit_client_is_synchronous_and_fail_loud(tmp_path):
    url = f"sqlite:///{tmp_path}/client.db"
    client = AgentTraceClient(url)
    run_id = client.create_run("explicit", project="p")
    client.log_event(run_id, source="a", target="b", type="tool_call", duration_ms=4)
    client.end_run(run_id, "failed")
    [stored] = read_runs(url)
    assert stored["status"] == "failed" and stored["project"] == "p" and len(stored["events"]) == 1

    with pytest.raises(ValueError):
        client.log_event(run_id, source="a", target="b", type="bad")
    with pytest.raises(LookupError):
        client.end_run("missing")
