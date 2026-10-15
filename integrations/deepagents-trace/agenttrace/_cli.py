"""The `agenttrace` command: a deprecated name for `lanetrace`."""

from __future__ import annotations

import sys


def main() -> None:
    print("agenttrace: deprecated, the command is now `lanetrace` (same options).", file=sys.stderr)
    from lanetrace.cli import main as lanetrace_main

    lanetrace_main()


if __name__ == "__main__":
    main()
