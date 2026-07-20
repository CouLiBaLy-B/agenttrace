"""Point DATABASE_URL at a throwaway per-session SQLite file *before* any
`agenttrace.server.*` module is imported (db.py builds its engine at import
time), and use a fixed test secret for session-cookie signing.
"""

import os
import tempfile

_tmp_dir = tempfile.mkdtemp(prefix="agenttrace-tests-")
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp_dir}/test.db"
os.environ["AGENTTRACE_SECRET"] = "test-secret-not-for-production"
