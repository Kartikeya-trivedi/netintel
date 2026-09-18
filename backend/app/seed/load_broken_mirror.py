"""Load Operation Broken Mirror into the database.

Run:  uv run python -m app.seed.load_broken_mirror
Also invoked by POST /api/demo/broken-mirror/reset.

Creates the three case files with stable case codes, preserves and extracts
every original through the investigation layer, runs the older case pipeline
over the same originals so the existing views show them too, and sets up demo
principals, purpose-bound grants and one workspace.

The analyst's grant is deliberately narrower (BM-1 only, for a different
purpose): it is what the access tests and the demo use to show that asking for
a case is not the same as being allowed to compare it.
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.investigation import service
from app.investigation.models import CaseGrant, Principal, Workspace
from app.seed.broken_mirror import CASES, Cast, build_case_files, default_cast
from app.seed.load_demo import purge_cases

logger = logging.getLogger(__name__)

PURPOSE = "Joint review: Operation Broken Mirror"
WORKSPACE_NAME = "Broken Mirror joint review"

PRINCIPALS = [
    ("inspector.rao", "Insp. A. Rao", "investigator"),
    ("supervisor.iyer", "Supervisor M. Iyer", "reviewer"),
    ("analyst.das", "Analyst P. Das", "investigator"),
]

# Loaded in the order an investigator would receive them: narrative first,
# then the records that confirm or contradict it.
KIND_ORDER = {"report": 0, "subscriber_records": 1, "transactions": 2, "call_records": 3}


def _principal(db: Session, handle: str, name: str, role: str) -> Principal:
    principal = db.scalar(select(Principal).where(Principal.handle == handle))
    if principal is None:
        principal = Principal(handle=handle, display_name=name, role=role)
        db.add(principal)
        db.flush()
    return principal


def reset_and_load(db: Session, *, cast: Cast | None = None, legacy: bool = True) -> Workspace:
    """Delete any previous Broken Mirror cases and load a fresh set."""
    cast = cast or default_cast()
    files = build_case_files(cast)

    names = [name for _, name, _, _ in CASES]
    existing = db.scalars(select(models.Case).where(models.Case.name.in_(names))).all()
    purge_cases(db, [case.id for case in existing])
    service.clear_cache()

    people = {handle: _principal(db, handle, name, role) for handle, name, role in PRINCIPALS}
    db.commit()

    case_ids: dict[str, int] = {}
    for code, name, agency, description in CASES:
        case = models.Case(name=name, description=description)
        db.add(case)
        db.commit()
        db.refresh(case)
        case_ids[code] = case.id
        service.ensure_profile(db, case.id, code, agency)
        db.commit()

        for item in sorted(files[code], key=lambda f: (KIND_ORDER[f.kind], f.filename)):
            document_id = None
            if legacy:
                document_id = _legacy_ingest(db, case.id, item.filename, item.kind, item.raw)
            service.ingest(
                db,
                case_id=case.id,
                filename=item.filename,
                kind=item.kind,
                raw=item.raw,
                source_org=item.source_org,
                document_id=document_id,
            )

    for handle in ("inspector.rao", "supervisor.iyer"):
        for case_id in case_ids.values():
            db.add(
                CaseGrant(
                    principal_id=people[handle].id,
                    case_id=case_id,
                    purpose=PURPOSE,
                    granted_by="SP Crime (demo)",
                )
            )
    db.add(
        CaseGrant(
            principal_id=people["analyst.das"].id,
            case_id=case_ids["BM-1"],
            purpose="Review: loan-app complaints",
            granted_by="SP Crime (demo)",
        )
    )
    db.commit()

    return service.create_workspace(
        db,
        people["inspector.rao"],
        case_ids=list(case_ids.values()),
        purpose=PURPOSE,
        name=WORKSPACE_NAME,
    )


def _legacy_ingest(db: Session, case_id: int, filename: str, kind: str, raw: bytes) -> int:
    """Run the older per-case pipeline over the same original, for its views."""
    import hashlib

    from app.services.ingest.pipeline import process_document

    document = models.Document(
        case_id=case_id,
        filename=filename,
        doc_type=kind,
        content_hash=hashlib.sha256(raw).hexdigest(),
        status="pending",
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    process_document(document.id, raw, detect=False)
    db.expire_all()
    return document.id


if __name__ == "__main__":
    from app.db import SessionLocal, init_db

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    init_db()
    with SessionLocal() as session:
        loaded = reset_and_load(session)
        print(f"Loaded Operation Broken Mirror: workspace {loaded.id} ({loaded.name})")
