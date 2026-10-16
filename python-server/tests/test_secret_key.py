import pytest
from itsdangerous import URLSafeTimedSerializer

from lanetrace.server import security

# The public default of releases before 0.2 (named before the LaneTrace rename).
OLD_DEFAULT = "agenttrace-dev-secret-key-change-in-production"


@pytest.fixture
def no_secret(monkeypatch):
    monkeypatch.delenv("LANETRACE_SECRET", raising=False)
    monkeypatch.setattr(security, "_random_secret", None)


def test_unset_secret_is_random_and_stable(no_secret):
    a = security._secret_key()
    assert a == security._secret_key()
    assert a != OLD_DEFAULT and len(a) >= 32


def test_token_signed_with_old_default_rejected(no_secret):
    forged = URLSafeTimedSerializer(OLD_DEFAULT, salt="lanetrace-session").dumps({"userId": "u1"})
    assert security.read_session_token(forged) is None
    assert security.read_session_token(security.create_session_token("u1")) == "u1"


def test_env_secret_used(monkeypatch):
    monkeypatch.setenv("LANETRACE_SECRET", "abc")
    assert security._secret_key() == "abc"


import pytest  # noqa: E402

from lanetrace.server import security  # noqa: E402


@pytest.mark.parametrize("value", ["0", "false", "False", "NO", "off", " ", ""])
def test_require_secret_off_values(monkeypatch, value):
    monkeypatch.delenv("LANETRACE_SECRET", raising=False)
    monkeypatch.delenv("AGENTTRACE_SECRET", raising=False)
    monkeypatch.setenv("LANETRACE_REQUIRE_SECRET", value)
    assert security.missing_required_secret() is False


@pytest.mark.parametrize("value", ["1", "true", "TRUE", "yes"])
def test_require_secret_on_values(monkeypatch, value):
    monkeypatch.delenv("LANETRACE_SECRET", raising=False)
    monkeypatch.delenv("AGENTTRACE_SECRET", raising=False)
    monkeypatch.setenv("LANETRACE_REQUIRE_SECRET", value)
    assert security.missing_required_secret() is True
    monkeypatch.setenv("LANETRACE_SECRET", "s")
    assert security.missing_required_secret() is False
