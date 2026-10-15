"""Names that changed when AgentTrace (up to 0.2) became LaneTrace (0.3),
with the old ones still accepted.

- `LANETRACE_*` environment variables: every read goes through
  `getenv("TRACKING_URI")` and friends. The new name wins; when only the old
  `AGENTTRACE_*` one is set it is used, and the first such fallback logs one
  deprecation line per process naming the new variable(s).
- The default local database `./lanetrace.db`: when it doesn't exist but the
  old `./agenttrace.db` does, that one is used (logged once per process).
"""

from __future__ import annotations

import logging
import os
import threading
import warnings
from typing import Optional, overload

PREFIX = "LANETRACE_"
LEGACY_PREFIX = "AGENTTRACE_"

_log = logging.getLogger("lanetrace")
_lock = threading.Lock()
_warned = False
_db_warned = False

DEFAULT_SQLITE_FILE = "lanetrace.db"
LEGACY_SQLITE_FILE = "agenttrace.db"
DEFAULT_SQLITE_URL = f"sqlite:///./{DEFAULT_SQLITE_FILE}"
LEGACY_SQLITE_URL = f"sqlite:///./{LEGACY_SQLITE_FILE}"


def names(name: str) -> list[str]:
    """`["LANETRACE_<name>", "AGENTTRACE_<name>"]`, in lookup order (for
    click's `envvar=`, which takes the first one that is set)."""
    return [PREFIX + name, LEGACY_PREFIX + name]


def _warn_legacy() -> None:
    global _warned
    with _lock:
        if _warned:
            return
        _warned = True
    legacy = sorted(k for k in os.environ if k.startswith(LEGACY_PREFIX) and os.environ[k])
    renames = ", ".join(f"{k} -> {PREFIX}{k[len(LEGACY_PREFIX):]}" for k in legacy)
    message = (
        f"LaneTrace: the AGENTTRACE_* environment variables are deprecated, rename them: {renames}"
    )
    warnings.warn(message, DeprecationWarning, stacklevel=4)
    _log.warning(message)


@overload
def getenv(name: str) -> Optional[str]: ...
@overload
def getenv(name: str, default: str) -> str: ...
def getenv(name: str, default: Optional[str] = None) -> Optional[str]:
    """`LANETRACE_<name>`, else the legacy `AGENTTRACE_<name>`, else `default`.
    An empty value counts as unset (as click's `envvar=` does)."""
    value = os.environ.get(PREFIX + name)
    if value:
        return value
    value = os.environ.get(LEGACY_PREFIX + name)
    if value:
        _warn_legacy()
        return value
    return default


def is_legacy(name: str) -> bool:
    """True when `name` would be read from its `AGENTTRACE_*` fallback."""
    return not os.environ.get(PREFIX + name) and bool(os.environ.get(LEGACY_PREFIX + name))


def warn_if_legacy(name: str) -> None:
    """Log the deprecation line when a value for `name` came from the legacy
    variable through another reader (click's `envvar=`)."""
    if is_legacy(name):
        _warn_legacy()


def default_sqlite_url() -> str:
    """`sqlite:///./lanetrace.db`, or the pre-rename `./agenttrace.db` when
    only that file exists in the working directory."""
    global _db_warned
    if os.path.exists(DEFAULT_SQLITE_FILE) or not os.path.exists(LEGACY_SQLITE_FILE):
        return DEFAULT_SQLITE_URL
    with _lock:
        warn, _db_warned = not _db_warned, True
    if warn:
        _log.warning(
            "LaneTrace: using ./%s (the pre-0.3 default database); rename it to ./%s",
            LEGACY_SQLITE_FILE,
            DEFAULT_SQLITE_FILE,
        )
    return LEGACY_SQLITE_URL


def _reset_for_tests() -> None:
    global _warned, _db_warned
    _warned = _db_warned = False
