"""Ingest orchestration: parse -> extract -> resolve -> persist -> detect.

Runs in a FastAPI BackgroundTask started by routers.ingest.upload_document.
Owns its own DB session because the request session is already closed by the
time this executes.
"""

from __future__ import annotations

import logging

from app import models
from app.db import SessionLocal

logger = logging.getLogger(__name__)


def process_document(document_id: int, raw: bytes) -> None:
    """Process one uploaded document end to end.

    Failures are recorded on the Document row rather than raised, so one bad
    file never blocks the rest of a bulk upload (PLAN.md section 9).

    TODO(Phase 1-2, 5): implement the body.
      report      -> report_parser.parse_to_text
                     -> ner.extract_entities -> relations.extract_relations
                     -> resolver.resolve -> persist Entity/Mention/Relationship
      transactions/call_records/subscriber_records
                  -> csv_ingest.parse_csv -> persist rows, then link accounts
                     and numbers to entities via the subscriber records
      finally     -> anomaly.detector.run_detection(case_id) and
                     graph.analytics.invalidate_cache(case_id)
    """
    db = SessionLocal()
    try:
        doc = db.get(models.Document, document_id)
        if doc is None:
            logger.error("Document %s vanished before processing", document_id)
            return

        doc.status = "processing"
        db.commit()

        raise NotImplementedError("Phase 1-2: see PLAN.md sections 5.1-5.4")

    except Exception as exc:
        db.rollback()
        doc = db.get(models.Document, document_id)
        if doc is not None:
            doc.status = "failed"
            doc.error = f"{type(exc).__name__}: {exc}"
            db.commit()
        logger.exception("Ingest failed for document %s", document_id)
    finally:
        db.close()
