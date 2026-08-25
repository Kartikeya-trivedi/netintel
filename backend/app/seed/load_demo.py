"""Load generated demo assets into the database.

Run:  uv run python -m app.seed.load_demo
Also invoked by the POST /api/demo/reset endpoint.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app import models


def reset_and_load(db: Session) -> models.Case:
    """Delete any existing demo case and load a fresh one from demo_assets.

    TODO(Phase 1): implement.
      1. delete the existing case named CASE_NAME, cascading to its rows
      2. create the case, then feed every file in demo_assets through
         services.ingest.pipeline.process_document
      3. return the new Case
    """
    raise NotImplementedError("Phase 1: see PLAN.md section 7")


if __name__ == "__main__":
    from app.db import SessionLocal, init_db

    init_db()
    with SessionLocal() as session:
        case = reset_and_load(session)
        print(f"Loaded demo case {case.id}: {case.name}")
