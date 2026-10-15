"""The `scrub` anonymizer shown in docs/integration-callback.md and in
notebook 02 is copied by users: it must handle what the handler gives it
(dicts of JSON values, and strings) including escapes and non-ASCII text.
The functions are taken from those files, so the tests follow the docs."""

import json
import re
from pathlib import Path

import pytest

from lanetrace.langchain import AsyncLaneTraceCallbackHandler, AsyncHttpEventClient

ROOT = Path(__file__).resolve().parents[3]


def _from_docs():
    text = (ROOT / "docs" / "integration-callback.md").read_text(encoding="utf-8")
    block = next(b for b in re.findall(r"```python\n(.*?)```", text, re.S) if "def scrub" in b)
    namespace = {}
    exec(block.split("handler = ")[0], namespace)  # the definitions, not the handler line
    return namespace["scrub"]


def _from_notebook():
    path = ROOT / "python-server" / "examples" / "notebooks" / "02_async_callback_handler.ipynb"
    cells = json.loads(path.read_text(encoding="utf-8"))["cells"]
    source = next("".join(c["source"]) for c in cells if c["cell_type"] == "code" and "def scrub" in "".join(c["source"]))
    namespace = {}
    exec(source, namespace)
    return namespace["scrub"]


SCRUBS = pytest.mark.parametrize("scrub", [_from_docs(), _from_notebook()], ids=["docs", "notebook"])


@SCRUBS
def test_scrub_masks_strings_with_escapes_and_accents(scrub):
    assert scrub("Contact:\njane@x.com") == "Contact:\n<email>"
    assert scrub("café@x.com, \"quoted\" \\ backslash") == '<email>, "quoted" \\ backslash'


@SCRUBS
def test_scrub_walks_dicts_and_lists(scrub):
    payload = {"message": "écrire à jane.doe@example.com", "args": {"to": ["a@b.co", "plain"], "n": 3}, "none": None}
    assert scrub(payload) == {
        "message": "écrire à <email>",
        "args": {"to": ["<email>", "plain"], "n": 3},
        "none": None,
    }


@SCRUBS
async def test_scrub_masks_what_the_handler_sends(scrub, mocker):
    post = mocker.patch("httpx.AsyncClient.post")
    response = mocker.Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {"runId": "run_1", "event": {}}
    post.return_value = response

    client = AsyncHttpEventClient(url="http://localhost:3000", api_key="atr_test")
    handler = AsyncLaneTraceCallbackHandler("chat with café@x.com", client=client, anonymizer=scrub)
    handler.on_user_message("Contact:\njane.doe@example.com")
    await handler.finish("completed", answer="Mailed jane.doe@example.com")
    await handler.aclose()

    bodies = [call.kwargs["json"] for call in post.call_args_list]
    assert "@" not in json.dumps(bodies, ensure_ascii=False)
    assert bodies[0]["name"] == "chat with <email>"
    assert bodies[1]["label"] == "Contact:\n<email>"
    assert bodies[1]["payload"] == {"message": "Contact:\n<email>"}
