import logging

import pytest

from agenttrace.tracking import _uri


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    for var in ("AGENTTRACE_TRACKING_URI", "AGENTTRACE_URL", "AGENTTRACE_KEY"):
        monkeypatch.delenv(var, raising=False)
    _uri.set_tracking_uri(None)
    monkeypatch.setattr(_uri, "_legacy_logged", False)
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


def test_key_only_falls_back_to_legacy_server(monkeypatch, caplog):
    """Pre-0.2 setups set only AGENTTRACE_KEY and posted to localhost:3000."""
    monkeypatch.setenv("AGENTTRACE_KEY", "atr_x")
    with caplog.at_level(logging.INFO, logger="agenttrace.tracking._uri"):
        assert _uri.get_tracking_uri() == "http://localhost:3000"
    assert "AGENTTRACE_KEY" in caplog.text
    monkeypatch.setenv("AGENTTRACE_URL", "http://legacy:3000/api/events")
    assert _uri.get_tracking_uri() == "http://legacy:3000"
    monkeypatch.setenv("AGENTTRACE_TRACKING_URI", "sqlite:///env.db")
    assert _uri.get_tracking_uri() == "sqlite:///env.db"
    _uri.set_tracking_uri("sqlite:///explicit.db")
    assert _uri.get_tracking_uri() == "sqlite:///explicit.db"
