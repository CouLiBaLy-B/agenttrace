"""Sync example: a research agent instrumented with AgentTrace.

Setup:
    pip install -e ..                       # from this examples/ dir
    pip install deepagents langchain-openai
    export OPENAI_API_KEY=...
    export AGENTTRACE_KEY=atr_...            # project API key, Integration tab
    export AGENTTRACE_URL=http://localhost:3000/api/events   # default

Run:
    python sync_basic.py
"""

from deepagents import create_deep_agent
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI

from agenttrace_langchain import AgentTraceMiddleware


@tool
def web_search(query: str) -> str:
    """Search the web and return the top results as text."""
    return f"[stub] top results for: {query}"


@tool
def fetch_page(url: str) -> str:
    """Fetch and return the text content of a web page."""
    return f"[stub] content of {url}"


def main() -> None:
    agent = create_deep_agent(
        model=ChatOpenAI(model="gpt-4o-mini", temperature=0),
        tools=[web_search, fetch_page],
        system_prompt=(
            "You are a research assistant. Use web_search + fetch_page to "
            "answer the user's question, then synthesize a cited summary."
        ),
        # One middleware instance = one AgentTrace run.
        middleware=[AgentTraceMiddleware(run_name="sync example — Rust web frameworks")],
    )

    result = agent.invoke(
        {"messages": [{"role": "user", "content": "What's the state of Rust web frameworks in 2025?"}]}
    )

    print("answer:", result["messages"][-1].content)
    print("trace: open the run in AgentTrace to replay it frame by frame")


if __name__ == "__main__":
    main()
