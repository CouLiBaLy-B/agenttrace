"""The spec's success criterion, verbatim: no key, no server, autolog, and the
run lands in ./agenttrace.db where `agenttrace ui` reads it."""

import os
import subprocess
import sys
import textwrap

from tests.conftest import read_runs


def test_zero_config_autolog_script_writes_local_db(tmp_path):
    script = textwrap.dedent("""
        from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
        from langchain_core.messages import AIMessage
        from langchain_core.runnables import RunnableLambda

        import agenttrace
        import agenttrace.langchain

        agenttrace.set_project("support-bot")
        agenttrace.langchain.autolog()
        model = GenericFakeChatModel(messages=iter([AIMessage(content="hello")]))
        agent = RunnableLambda(lambda q: {"messages": [model.invoke(q)]}, name="agent")
        agent.invoke("hi")
    """)
    env = {k: v for k, v in os.environ.items() if not k.startswith("AGENTTRACE_") and k != "DATABASE_URL"}
    subprocess.run([sys.executable, "-c", script], cwd=tmp_path, env=env, check=True, timeout=120)
    [run] = read_runs(f"sqlite:///{tmp_path}/agenttrace.db")
    assert run["project"] == "support-bot" and run["status"] == "completed"
    assert [e["type"] for e in run["events"]] == ["llm_call", "final_answer"]
