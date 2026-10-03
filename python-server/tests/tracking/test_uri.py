import pytest

from agenttrace.tracking import _uri


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    for var in ("AGENTTRACE_TRACKING_URI", "AGENTTRACE_URL"):
        monkeypatch.delenv(var, raising=False)
    _uri.set_tracking_uri(None)
    yield
    _uri.set_tracking_uri(None)


def test_default_is_local_sqlite():
    assert _uri.get_tracking_uri() == "sqlite:///./agenttrace.db"


def test_resolution_order(monkeypatch):
    monkeypatch.setenv("AGENTTRACE_URL", "http://legacy:3000/api/events")
    assert _uri.get_tracking_uri() == "http://legacy:3000"
    monkeypatch.setenv("AGENTTRACE_TRACKING_URI", "http://env:3000")
    assert _uri.get_tracking_uri() == "http://env:3000"
    _uri.set_tracking_uri("sqlite:///explicit.db")
    assert _uri.get_tracking_uri() == "sqlite:///explicit.db"
    _uri.set_tracking_uri(None)
    assert _uri.get_tracking_uri() == "http://env:3000"


def test_events_url_and_http_detection():
    assert _uri.events_url("http://h:3000") == "http://h:3000/api/events"
    assert _uri.events_url("https://h/") == "https://h/api/events"
    assert _uri.events_url("http://h/api/events") == "http://h/api/events"
    assert _uri.is_http_uri("HTTPS://h") and not _uri.is_http_uri("sqlite:///x.db")
