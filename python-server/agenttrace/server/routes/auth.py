"""Auth routes — a from-scratch signed-cookie session, replacing NextAuth.

Not wire-compatible with NextAuth's `/api/auth/[...nextauth]` (that handler's
CSRF/provider/callback machinery is Next.js-specific and out of scope here,
per the plan) — these are new, simple endpoints the Phase 2 frontend will be
adapted to call instead.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..security import (
    SESSION_COOKIE_NAME,
    SESSION_MAX_AGE_SECONDS,
    create_session_token,
    hash_password,
    read_session_token,
    verify_password,
)
from ..serializers import user_out
from ..seed import seed_demo_data

router = APIRouter(prefix="/api/auth", tags=["auth"])


class SignupBody(BaseModel):
    email: str
    password: str
    name: str | None = None


class SigninBody(BaseModel):
    email: str
    password: str


def _set_session_cookie(response: Response, user_id: str) -> None:
    response.set_cookie(
        SESSION_COOKIE_NAME,
        create_session_token(user_id),
        max_age=SESSION_MAX_AGE_SECONDS,
        httponly=True,
        samesite="lax",
    )


@router.post("/signup", status_code=201)
def signup(body: SignupBody, response: Response, db: Session = Depends(get_db)):
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail={"error": "Password must be at least 6 characters"})
    if db.query(models.User).filter(models.User.email == body.email).first():
        raise HTTPException(status_code=400, detail={"error": "An account with this email already exists"})

    user = models.User(
        email=body.email,
        name=body.name or body.email.split("@")[0],
        password_hash=hash_password(body.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    seed_demo_data(db, user.id)

    _set_session_cookie(response, user.id)
    return {"user": user_out(user)}


@router.post("/signin")
def signin(body: SigninBody, response: Response, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == body.email).first()
    if not user or not user.password_hash:
        raise HTTPException(status_code=401, detail={"error": "No account found with this email. Sign up instead."})
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail={"error": "Incorrect password"})

    _set_session_cookie(response, user.id)
    return {"user": user_out(user)}


@router.post("/signout")
def signout(response: Response):
    response.delete_cookie(SESSION_COOKIE_NAME)
    return {"ok": True}


@router.get("/session")
def session(request: Request, db: Session = Depends(get_db)):
    """Unlike `require_user`, this never raises — an anonymous caller just
    gets `{"user": null}`, matching how a frontend checks session-on-load."""
    token = request.cookies.get(SESSION_COOKIE_NAME)
    user_id = read_session_token(token) if token else None
    user = db.get(models.User, user_id) if user_id else None
    return {"user": user_out(user) if user else None}
