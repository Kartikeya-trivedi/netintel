"""Load generated demo assets into the database.

Run:  uv run python -m app.seed.load_demo
Also invoked by the POST /api/demo/reset endpoint.
"""

from __future__ import annotations

import hashlib
import logging

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from app import models
from app.db import Base
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


def purge_cases(db: Session, case_ids: list[int]) -> None:
    """Delete cases and every row that belongs to them.

    Deleting the case row is not enough on its own. Only documents and entities
    are cascaded by the ORM; transactions, call records, relationships, alerts,
    and snapshots hang off case_id with ON DELETE CASCADE, which SQLite ignores
    while the foreign_keys pragma is off. SQLite then reuses the freed primary
    key, so the leftovers are silently adopted by the next case created: each
    demo reset used to stack another full copy of the transactions and call
    records onto the demo, inflating every count and every anomaly baseline.
    """
    if not case_ids:
        return

    stale_docs = select(models.Document.id).where(models.Document.case_id.in_(case_ids))
    stale_entities = select(models.Entity.id).where(models.Entity.case_id.in_(case_ids))

    # Mentions carry no case_id; reach them through their document or entity.
    db.execute(
        delete(models.Mention).where(
            or_(
                models.Mention.document_id.in_(stale_docs),
                models.Mention.entity_id.in_(stale_entities),
            )
        )
    )

    # Dependents before parents, so no row is ever left pointing at a deleted one.
    for table in reversed(Base.metadata.sorted_tables):
        if table.name != "cases" and "case_id" in table.c:
            db.execute(table.delete().where(table.c.case_id.in_(case_ids)))

    db.execute(delete(models.Case).where(models.Case.id.in_(case_ids)))
    db.commit()
    db.expire_all()


def reset_and_load(db: Session) -> models.Case:
    """Delete any existing demo case and load a fresh one from demo_assets."""
    if not (OUTPUT_DIR / "ground_truth.json").exists():
        logger.info("Demo assets missing; generating them first")
        generate_assets()

    existing = db.scalars(select(models.Case).where(models.Case.name == CASE_NAME)).all()
    purge_cases(db, [case.id for case in existing])

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
        process_document(doc.id, raw, detect=False)

    db.expire_all()

    # The seed is one ingest event, so detection runs once on the finished case.
    # Detecting after every file would take the centrality baseline from a
    # half-built network and then report each person the load order happened
    # to promote as having "entered the top 5 brokers" -- a dozen findings that
    # say nothing about the case.
    from app.services.anomaly.detector import run_detection

    run_detection(db, case.id)
    return case


if __name__ == "__main__":
    from app.db import SessionLocal, init_db

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    init_db()
    with SessionLocal() as session:
        loaded = reset_and_load(session)
        print(f"Loaded demo case {loaded.id}: {loaded.name}")
