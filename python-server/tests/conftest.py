"""Point DATABASE_URL at a throwaway per-session SQLite file *before* any
`agenttrace.server.*` module is imported (db.py builds its engine at import
time), and use a fixed test secret for session-cookie signing.
"""

import os
import tempfile

_tmp_dir = tempfile.mkdtemp(prefix="agenttrace-tests-")
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp_dir}/test.db"
os.environ["AGENTTRACE_SECRET"] = "test-secret-not-for-production"

import json

import pytest


def read_runs(url):
    from agenttrace.store import db as store_db
    from agenttrace.store import models

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
    import agenttrace
    from agenttrace.tracking import fluent

    for var in ("AGENTTRACE_TRACKING_URI", "AGENTTRACE_URL", "AGENTTRACE_PROJECT", "AGENTTRACE_KEY"):
        monkeypatch.delenv(var, raising=False)
    url = f"sqlite:///{tmp_path}/tracking.db"
    agenttrace.set_tracking_uri(url)
    agenttrace.set_project(None)
    yield url
    fluent._reset_for_tests()
    agenttrace.set_tracking_uri(None)
