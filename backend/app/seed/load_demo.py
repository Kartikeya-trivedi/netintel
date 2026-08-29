"""Load generated demo assets into the database.

Run:  uv run python -m app.seed.load_demo
Also invoked by the POST /api/demo/reset endpoint.
"""

from __future__ import annotations

import hashlib
import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.seed.generate_demo_data import (
    CASE_DESCRIPTION,
    CASE_NAME,
    OUTPUT_DIR,
)
from app.seed.generate_demo_data import main as generate_assets
from app.services.ingest.pipeline import process_document

logger = logging.getLogger(__name__)

# Subscriber records first: once identifiers are tied to owners, transactions
# and call records link to people as they land instead of needing a second pass.
LOAD_ORDER = [
    ("subscriber_records.csv", "subscriber_records"),
    ("transactions.csv", "transactions"),
    ("call_records.csv", "call_records"),
]


def reset_and_load(db: Session) -> models.Case:
    """Delete any existing demo case and load a fresh one from demo_assets."""
    if not (OUTPUT_DIR / "ground_truth.json").exists():
        logger.info("Demo assets missing; generating them first")
        generate_assets()

    existing = db.scalars(select(models.Case).where(models.Case.name == CASE_NAME)).all()
    stale_ids = [case.id for case in existing]

    # Alerts and snapshots hang off case_id without an ORM relationship, and
    # SQLite does not enforce ON DELETE CASCADE unless the pragma is set. SQLite
    # also reuses the freed primary key, so anything left behind would be
    # silently adopted by the case created below -- yesterday's alerts showing
    # up against today's data. Clear them explicitly.
    if stale_ids:
        db.query(models.Alert).filter(models.Alert.case_id.in_(stale_ids)).delete(
            synchronize_session=False
        )
        db.query(models.CaseSnapshot).filter(
            models.CaseSnapshot.case_id.in_(stale_ids)
        ).delete(synchronize_session=False)

    for case in existing:
        db.delete(case)
    db.commit()

    case = models.Case(name=CASE_NAME, description=CASE_DESCRIPTION)
    db.add(case)
    db.commit()
    db.refresh(case)

    reports = sorted(OUTPUT_DIR.glob("report_*.txt"))
    assets = [(p, "report") for p in reports]
    assets += [(OUTPUT_DIR / name, kind) for name, kind in LOAD_ORDER]

    for path, doc_type in assets:
        if not path.exists():
            logger.warning("Demo asset %s is missing; skipping", path.name)
            continue

        raw = path.read_bytes()
        doc = models.Document(
            case_id=case.id,
            filename=path.name,
            doc_type=doc_type,
            content_hash=hashlib.sha256(raw).hexdigest(),
            status="pending",
        )
        db.add(doc)
        db.commit()
        db.refresh(doc)

        # process_document opens its own session, so the row must be committed
        # before it runs.
        process_document(doc.id, raw)

    db.expire_all()
    return case


if __name__ == "__main__":
    from app.db import SessionLocal, init_db

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    init_db()
    with SessionLocal() as session:
        loaded = reset_and_load(session)
        print(f"Loaded demo case {loaded.id}: {loaded.name}")
