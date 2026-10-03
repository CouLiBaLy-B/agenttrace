"""Fail if a built wheel doesn't ship the UI bundle (used by CI and the
PyPI publish workflow): `python scripts/check_wheel.py dist/*.whl`."""

import sys
import zipfile

REQUIRED = "agenttrace/server/static/index.html"

for path in sys.argv[1:]:
    with zipfile.ZipFile(path) as wheel:
        if REQUIRED not in wheel.namelist():
            sys.exit(f"{path}: missing {REQUIRED} — run `bun run build:ui` before building the wheel")
    print(f"{path}: UI bundle present")
