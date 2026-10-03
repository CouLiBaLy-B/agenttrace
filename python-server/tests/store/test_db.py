import threading

from sqlalchemy import text

from agenttrace.store import db as store_db
from agenttrace.store import models


def test_get_engine_is_cached_per_url(tmp_path):
    url = f"sqlite:///{tmp_path}/a.db"
    assert store_db.get_engine(url) is store_db.get_engine(url)
    assert store_db.get_engine(url) is not store_db.get_engine(f"sqlite:///{tmp_path}/b.db")


def test_init_db_creates_all_tables(tmp_path):
    url = f"sqlite:///{tmp_path}/c.db"
    store_db.init_db(url)
    with store_db.get_engine(url).connect() as conn:
        names = {row[0] for row in conn.execute(text("select name from sqlite_master where type='table'"))}
    assert {"users", "projects", "runs", "events", "api_keys"} <= names


def test_server_models_are_the_store_models():
    from agenttrace.server import models as server_models

    assert server_models.Event is models.Event
    assert server_models.Base is models.Base


def test_concurrent_writer_and_reader_on_same_sqlite_file(tmp_path):
    """Review focus #2: the SDK writes while `agenttrace ui` reads the same file."""
    url = f"sqlite:///{tmp_path}/shared.db"
    store_db.init_db(url)
    writer = store_db.get_engine(url)
    from sqlalchemy import create_engine

    reader = create_engine(url, connect_args={"check_same_thread": False, "timeout": 30})
    errors = []

    def write():
        try:
            for i in range(200):
                with writer.begin() as conn:
                    conn.execute(
                        text("insert into users (id, email, createdAt, updatedAt) values (:i, :e, datetime(), datetime())"),
                        {"i": f"u{i}", "e": f"u{i}@x"},
                    )
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    thread = threading.Thread(target=write)
    thread.start()
    for _ in range(200):
        with reader.connect() as conn:
            conn.execute(text("select count(*) from users")).scalar()
    thread.join()
    assert errors == []


def test_init_db_is_once_per_url_and_retries_a_cross_process_race(tmp_path, monkeypatch):
    from sqlalchemy.exc import OperationalError

    url = f"sqlite:///{tmp_path}/race.db"
    real = models.Base.metadata.create_all
    calls = []

    def create_all(bind):
        calls.append(bind)
        if len(calls) == 1:
            raise OperationalError("CREATE TABLE users", {}, Exception("table users already exists"))
        real(bind=bind)

    monkeypatch.setattr(models.Base.metadata, "create_all", create_all)
    store_db.init_db(url)
    store_db.init_db(url)
    assert len(calls) == 2  # one failed attempt, one retry, then cached


def test_sqlite_files_use_wal_but_memory_does_not(tmp_path):
    with store_db.get_engine(f"sqlite:///{tmp_path}/wal.db").connect() as conn:
        assert conn.execute(text("PRAGMA journal_mode")).scalar() == "wal"
    with store_db.get_engine("sqlite:///:memory:").connect() as conn:
        assert conn.execute(text("PRAGMA journal_mode")).scalar() == "memory"
