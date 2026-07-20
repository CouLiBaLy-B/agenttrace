"""Passwords, API keys, and session cookies.

API key generation/hash/prefix mirror src/lib/keys.ts exactly (same
`atr_<32 hex>` shape, same sha256 hash, same 12-char prefix) so existing keys
issued by the Next.js backend remain valid if a database is ever shared
between the two. Session handling replaces NextAuth's JWT cookie with a
plain signed cookie (itsdangerous) — intentionally not wire-compatible with
NextAuth (this is a from-scratch "auth maison", per the plan).
"""

from __future__ import annotations

import hashlib
import os
import secrets

import bcrypt
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

SESSION_COOKIE_NAME = "agenttrace_session"
SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60  # 30 days, same order of magnitude as NextAuth's default

# bcrypt silently ignores/rejects input past 72 bytes; truncate defensively
# rather than letting an unusually long password raise inside gensalt/hashpw.
_BCRYPT_MAX_BYTES = 72


def _bcrypt_bytes(password: str) -> bytes:
    return password.encode("utf-8")[:_BCRYPT_MAX_BYTES]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_bcrypt_bytes(password), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(_bcrypt_bytes(password), password_hash.encode("utf-8"))


def _secret_key() -> str:
    return os.getenv("AGENTTRACE_SECRET", "agenttrace-dev-secret-key-change-in-production")


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(_secret_key(), salt="agenttrace-session")


def create_session_token(user_id: str) -> str:
    return _serializer().dumps({"userId": user_id})


def read_session_token(token: str) -> str | None:
    try:
        data = _serializer().loads(token, max_age=SESSION_MAX_AGE_SECONDS)
    except (BadSignature, SignatureExpired):
        return None
    return data.get("userId")


# ----- API keys (atr_<32 hex>), same contract as src/lib/keys.ts -----


def generate_api_key() -> str:
    return "atr_" + secrets.token_hex(16)


def hash_api_key(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def key_prefix(key: str) -> str:
    return key[:12]
