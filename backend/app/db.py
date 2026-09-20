"""SQLAlchemy engine, session factory, and FastAPI dependency.

Imported by app.main (startup table creation) and every router in app.routers.
"""

from collections.abc import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings

settings = get_settings()

# check_same_thread=False is required for SQLite under FastAPI's threadpool.
engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False}
    if settings.database_url.startswith("sqlite")
    else {},
)


@event.listens_for(Engine, "connect")
def _enforce_sqlite_foreign_keys(dbapi_connection, connection_record) -> None:
    """Turn foreign keys on for SQLite connections.

    SQLite ignores foreign keys unless asked, once per connection. Without
    this every ondelete="CASCADE" in app.models is decorative: deleting a case
    leaves its children behind, and because ids restart on a reseeded database
    the next row inherits the orphans of the old one that held its id.
    """
    if type(dbapi_connection).__module__.split(".")[0] != "sqlite3":
        return
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA foreign_keys=ON")
    finally:
        cursor.close()

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    """Declarative base for all ORM models in app.models."""


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency yielding a scoped database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create all tables. Called on application startup."""
    from app import models  # noqa: F401  (registers models on Base.metadata)
    from app.investigation import models as investigation_models  # noqa: F401

    Base.metadata.create_all(bind=engine)
