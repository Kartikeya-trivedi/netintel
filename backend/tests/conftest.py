"""Shared pytest fixtures.

DATABASE_URL is set before any app import so the engine, which is created at
import time, binds to a throwaway file rather than the developer's database.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

_TEST_DB = Path(tempfile.gettempdir()) / "netintel_pytest.db"
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_TEST_DB.as_posix()}")

# Preserved originals and the signing key are runtime state too; tests keep
# theirs in a throwaway directory rather than the developer's store.
_TEST_STATE = Path(tempfile.mkdtemp(prefix="netintel_pytest_"))
os.environ.setdefault("EVIDENCE_STORE_DIR", str(_TEST_STATE / "evidence_store"))
os.environ.setdefault("SIGNING_KEY_PATH", str(_TEST_STATE / "keys" / "receipt_ed25519.pem"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.db import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_analytics_cache():
    """Keep cached analytics from leaking between tests.

    Case ids restart at 1 in every fresh test database, so without this a case
    would inherit another test's cached centrality.
    """
    from app.investigation import service
    from app.services.graph import analytics

    analytics.clear_all_caches()
    service.clear_cache()
    yield
    analytics.clear_all_caches()
    service.clear_cache()


@pytest.fixture
def db_session():
    """A fresh in-memory SQLite database per test."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = TestingSession()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client(db_session):
    """TestClient wired to the per-test database."""
    app.dependency_overrides[get_db] = lambda: db_session
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def case(db_session):
    from app import models

    obj = models.Case(name="Test Case", description="fixture")
    db_session.add(obj)
    db_session.commit()
    db_session.refresh(obj)
    return obj


@pytest.fixture(scope="session")
def demo_case():
    """Load the Operation Nightfall case once, through the real ingest pipeline.

    Deliberately end-to-end rather than fixture data: the point is to prove the
    extraction and analytics recover the planted structure from raw text, so
    stubbing any of it out would defeat the test.
    """
    from app.db import SessionLocal, engine, init_db
    from app.seed.load_demo import reset_and_load

    # Reset by dropping tables rather than deleting the file: on Windows the
    # engine still holds the file open from earlier tests, and unlink fails.
    init_db()
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    session = SessionLocal()
    try:
        yield session, reset_and_load(session)
    finally:
        session.close()


@pytest.fixture(scope="session")
def ground_truth():
    import json

    from app.seed.generate_demo_data import OUTPUT_DIR

    return json.loads((OUTPUT_DIR / "ground_truth.json").read_text(encoding="utf-8"))
