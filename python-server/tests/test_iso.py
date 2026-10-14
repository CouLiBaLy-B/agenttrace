from datetime import datetime, timezone

from agenttrace.server.serializers import _iso


def test_naive_datetimes_are_treated_as_utc():
    assert _iso(datetime(2026, 10, 3, 12, 0, 0)) == "2026-10-03T12:00:00+00:00"


def test_aware_datetimes_keep_their_offset():
    assert _iso(datetime(2026, 10, 3, 12, 0, 0, tzinfo=timezone.utc)) == "2026-10-03T12:00:00+00:00"


def test_none():
    assert _iso(None) is None
