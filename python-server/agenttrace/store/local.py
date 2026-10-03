"""The single `local` user that owns everything written without an account:
SDK writes to SQLite, and the server in `--auth none` mode. Projects are
found or created by name, like MLflow experiments."""

from __future__ import annotations

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import models

LOCAL_USER_EMAIL = "local@agenttrace"


def get_or_create_local_user(db: Session) -> models.User:
    user = db.query(models.User).filter(models.User.email == LOCAL_USER_EMAIL).first()
    if user:
        return user
    user = models.User(email=LOCAL_USER_EMAIL, name="Local")
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        # Another process (SDK vs. `agenttrace ui`) created it first.
        db.rollback()
        return db.query(models.User).filter(models.User.email == LOCAL_USER_EMAIL).one()
    db.refresh(user)
    return user


def get_or_create_project(db: Session, user: models.User, name: str) -> models.Project:
    project = (
        db.query(models.Project)
        .filter(models.Project.user_id == user.id, models.Project.name == name)
        .order_by(models.Project.created_at)
        .first()
    )
    if project:
        return project
    project = models.Project(name=name, user_id=user.id)
    db.add(project)
    db.commit()
    db.refresh(project)
    return project
