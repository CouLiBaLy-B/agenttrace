"""Point DATABASE_URL at a throwaway per-session SQLite file *before* any
`lanetrace.server.*` module is imported (db.py builds its engine at import
time), and use a fixed test secret for session-cookie signing.
"""

import os
import tempfile

_tmp_dir = tempfile.mkdtemp(prefix="lanetrace-tests-")
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp_dir}/test.db"
os.environ["LANETRACE_SECRET"] = "test-secret-not-for-production"
# Pre-rename names a developer's shell may still export: the fallback would
# pick them up (tests that need them set them explicitly).
for _var in [v for v in os.environ if v.startswith("AGENTTRACE_")]:
    del os.environ[_var]

import json

import pytest


def read_runs(url):
    from lanetrace.store import db as store_db
    from lanetrace.store import models

    with store_db.get_sessionmaker(url)() as db:
        runs = db.query(models.Run).order_by(models.Run.started_at).all()
        return [
            {
                "name": r.name,
                "status": r.status,
                "project": r.project.name,
                "events": [
                    {
                        "type": e.type,
                        "source": e.source,
                        "target": e.target,
                        "label": e.label,
                        "status": e.status,
                        "payload": json.loads(e.payload),
                    }
                    for e in r.events
                ],
            }
            for r in runs
        ]


@pytest.fixture
def tracking_db(tmp_path, monkeypatch):
    import lanetrace
    from lanetrace.tracking import fluent

    for var in ("LANETRACE_TRACKING_URI", "LANETRACE_URL", "LANETRACE_PROJECT", "LANETRACE_KEY"):
        monkeypatch.delenv(var, raising=False)
    url = f"sqlite:///{tmp_path}/tracking.db"
    lanetrace.set_tracking_uri(url)
    lanetrace.set_project(None)
    yield url
    fluent._reset_for_tests()
    lanetrace.set_tracking_uri(None)
