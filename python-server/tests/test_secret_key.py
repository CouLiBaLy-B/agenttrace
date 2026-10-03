import pytest
from itsdangerous import URLSafeTimedSerializer

from agenttrace.server import security

OLD_DEFAULT = "agenttrace-dev-secret-key-change-in-production"


@pytest.fixture
def no_secret(monkeypatch):
    monkeypatch.delenv("AGENTTRACE_SECRET", raising=False)
    monkeypatch.setattr(security, "_random_secret", None)


def test_unset_secret_is_random_and_stable(no_secret):
    a = security._secret_key()
    assert a == security._secret_key()
    assert a != OLD_DEFAULT and len(a) >= 32


def test_token_signed_with_old_default_rejected(no_secret):
    forged = URLSafeTimedSerializer(OLD_DEFAULT, salt="agenttrace-session").dumps({"userId": "u1"})
    assert security.read_session_token(forged) is None
    assert security.read_session_token(security.create_session_token("u1")) == "u1"


def test_env_secret_used(monkeypatch):
    monkeypatch.setenv("AGENTTRACE_SECRET", "abc")
    assert security._secret_key() == "abc"
