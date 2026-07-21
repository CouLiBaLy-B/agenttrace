"""Shared projection primitives — turn LangChain/LangGraph objects (messages,
model responses, tool args, callback metadata) into the small, bounded shapes
AgentTrace events carry.

Extracted from `middleware.py` so the middleware, the async run and the
callback handler (`callback.py`) all share ONE implementation instead of each
re-deriving "flatten message content", "which subagent emitted this", etc.
`middleware.py` re-imports these names for backwards compatibility.
"""

from __future__ import annotations

from typing import Any, Optional

from .run import LABEL_LIMIT, RESULT_LIMIT, truncate

# Tool-name substrings that mark a delegation to a sub-agent rather than a
# plain tool call (deepagents' `task`, or any `handoff_to_*`/`delegate_*`).
HANDOFF_MARKERS = ("handoff", "delegate", "task")


def model_name(request: Any) -> str:
    """Best-effort model label from a `ModelRequest` (or anything model-like)."""
    model = getattr(request, "model", None)
    name = getattr(model, "model", None) or getattr(model, "model_name", None)
    return str(name) if name else "LLM"


def content_to_text(content: Any) -> str:
    """Flatten LangChain message content to plain text. `content` is either a
    string or a list of content blocks (`[{"type": "text", "text": "..."}]`,
    the shape deepagents/most chat models use for system/human messages) —
    naively `str()`-ing the list would dump Python-repr noise instead of the
    actual text."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("text"):
                parts.append(str(block["text"]))
        return "".join(parts) if parts else str(content)
    return str(content)


def message_dict(message: Any, limit: int = RESULT_LIMIT) -> dict[str, Any]:
    role = getattr(message, "type", None) or type(message).__name__
    content = getattr(message, "content", message)
    return {"role": role, "content": truncate(content_to_text(content), limit)}


def messages_preview(messages: Any, system_message: Any = None) -> dict[str, Any]:
    """The input to an LLM call: system prompt (if any) + conversation messages.

    Accepts either a `ModelRequest`-style object (has `.messages`/
    `.system_message`) or a plain list of messages (the `on_chat_model_start`
    callback shape). A `system`-role message found inside the list is lifted
    into its own `system` field. Each field is truncated on its own so a huge,
    mostly-unchanging system prompt can't crowd out the conversation turns.
    """
    # ModelRequest-style object: unwrap its fields.
    if not isinstance(messages, list):
        request = messages
        system_message = system_message or getattr(request, "system_message", None)
        messages = getattr(request, "messages", None) or []

    convo = []
    system_text: Optional[str] = None
    for m in messages:
        role = getattr(m, "type", None) or (m.get("role") if isinstance(m, dict) else None)
        if system_text is None and role in ("system", "SystemMessage"):
            system_text = content_to_text(getattr(m, "content", m if not isinstance(m, dict) else m.get("content")))
            continue
        convo.append(message_dict(m))

    preview: dict[str, Any] = {"messages": convo}
    if system_message is not None:
        system_text = content_to_text(getattr(system_message, "content", system_message))
    if system_text is not None:
        preview["system"] = truncate(system_text, LABEL_LIMIT * 4)
    return preview


def last_model_message(response: Any) -> Any:
    """Unwrap a `ModelResponse` (`.result: list[BaseMessage]`) to its last
    message. Falls back to `response` itself if it isn't a ModelResponse."""
    result = getattr(response, "result", None)
    if isinstance(result, list) and result:
        return result[-1]
    return response


def response_preview(response: Any) -> str:
    content = result_content(response)
    return content if isinstance(content, str) else content_to_text(content)


def result_content(result: Any) -> Any:
    for attr in ("content", "result", "text"):
        value = getattr(result, attr, None)
        if value is not None:
            return value
    return result


def token_usage(response: Any) -> Optional[dict]:
    for attr in ("usage_metadata", "response_metadata"):
        value = getattr(response, attr, None)
        if value:
            return value
    return None


def extract_handoff_target(tool_args: Any) -> Optional[str]:
    if isinstance(tool_args, dict):
        return (
            tool_args.get("subagent_type")
            or tool_args.get("to")
            or tool_args.get("name")
            or tool_args.get("agent")
        )
    return None


# LangGraph node names that are STRUCTURAL (the agent's own model/tool/agent
# nodes), never a sub-agent identity. In a langchain/deepagents agent every
# LLM call runs under a node literally named "model" and every tool under
# "tools" — treating those as emitters produced a phantom "model" participant
# and hid the real orchestrator/sub-agent.
_STRUCTURAL_NODES = ("", "agent", "tools", "model", "__start__")


def emitting_agent(metadata: Optional[dict], parent_ids: Optional[list] = None) -> str:
    """Which agent emitted an event/callback: ``"main"`` for the top-level
    agent, otherwise a named sub-agent.

    `langgraph_node` is only ever a structural token (``model``/``tools``/
    ``agent``) — it does NOT carry the sub-agent name, so it can't identify the
    emitter. A sub-agent is instead recognised by a ``checkpoint_ns`` head that
    isn't structural. For deepagents the sub-agent's own inner calls actually
    share the ``task`` tool's ns (head ``tools``), so precise sub-agent naming
    needs the ns→name map the callback handler builds from ``task`` inputs;
    standalone, this returns ``"main"`` for any structural context.
    """
    metadata = metadata or {}
    checkpoint_ns = metadata.get("checkpoint_ns") or ""
    head = checkpoint_ns.split(":", 1)[0] if checkpoint_ns else ""
    if head and head not in _STRUCTURAL_NODES:
        return head
    node = metadata.get("langgraph_node") or ""
    if node and node not in _STRUCTURAL_NODES:
        return node
    return "main"
