"""Deprecated: AgentTrace was renamed LaneTrace (0.3.0). `import lanetrace`.

`agenttrace` and every `agenttrace.<submodule>` resolve to the matching
`lanetrace` module (the same module objects, so classes, module state and
`isinstance` checks are shared): `import agenttrace.langchain`,
`from agenttrace.tracking.async_http import AsyncHttpEventClient`,
`agenttrace.server.app`... Submodules are aliased when first imported, by
the finder below, so optional parts (`server`, `langchain`) still need their
extras, exactly as with `lanetrace`.
"""

from __future__ import annotations

import importlib
import importlib.abc
import importlib.util
import sys
import warnings

import lanetrace
from lanetrace import *  # noqa: F401,F403 - the 0.2 top-level API
from lanetrace import __all__, __version__  # noqa: F401

_OLD = __name__  # "agenttrace"
_NEW = "lanetrace"
# Modules of this shim package itself, not aliases.
_OWN = {f"{_OLD}._cli"}


class _AliasFinder(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    """`agenttrace.x.y` -> the `lanetrace.x.y` module object."""

    def __init__(self) -> None:
        self._real_specs: dict = {}

    def find_spec(self, fullname, path=None, target=None):
        if not fullname.startswith(_OLD + ".") or fullname in _OWN:
            return None
        if importlib.util.find_spec(_NEW + fullname[len(_OLD) :]) is None:
            return None  # ModuleNotFoundError for agenttrace.<missing>, as before
        return importlib.util.spec_from_loader(fullname, self)

    def create_module(self, spec):
        module = importlib.import_module(_NEW + spec.name[len(_OLD) :])
        # The import system stamps our alias spec onto the module it gets
        # back; keep the real one to put back in exec_module.
        self._real_specs[spec.name] = module.__spec__
        return module

    def exec_module(self, module):
        real = self._real_specs.pop(module.__spec__.name, None)
        if real is not None:
            module.__spec__ = real


def __getattr__(name: str):
    # `agenttrace.tracking`, `agenttrace.store`... and any other lanetrace attribute.
    try:
        return getattr(lanetrace, name)
    except AttributeError:
        raise AttributeError(f"module {_OLD!r} has no attribute {name!r}") from None


def __dir__():
    return sorted(set(globals()) | set(dir(lanetrace)))


if not any(isinstance(f, _AliasFinder) for f in sys.meta_path):
    sys.meta_path.insert(0, _AliasFinder())

warnings.warn(
    "agenttrace is deprecated: AgentTrace was renamed LaneTrace. "
    "Use `import lanetrace` (pip install lanetrace); `agenttrace` is an alias for it.",
    DeprecationWarning,
    stacklevel=2,
)
