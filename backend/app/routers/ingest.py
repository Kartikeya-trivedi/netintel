"""Document upload and processing status.

Uploads are persisted immediately and processed in a BackgroundTask so the UI can
poll Document.status (PLAN.md section 5.1).
"""

import hashlib

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
)
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.db import get_db
from app.schemas import DocumentDetail, DocumentOut
from app.services.ingest.pipeline import process_document

router = APIRouter(prefix="/api/cases/{case_id}/documents", tags=["ingest"])

ALLOWED_DOC_TYPES = {"report", "transactions", "call_records", "subscriber_records"}


@router.get("", response_model=list[DocumentOut])
def list_documents(case_id: int, db: Session = Depends(get_db)):
    stmt = (
        select(models.Document)
        .where(models.Document.case_id == case_id)
        .order_by(models.Document.uploaded_at.desc())
    )
    return db.scalars(stmt).all()


@router.post("", response_model=DocumentOut, status_code=202)
async def upload_document(
    case_id: int,
    background: BackgroundTasks,
    file: UploadFile = File(...),
    doc_type: str = Form("report"),
    db: Session = Depends(get_db),
):
    if db.get(models.Case, case_id) is None:
        raise HTTPException(status_code=404, detail="Case not found")
    if doc_type not in ALLOWED_DOC_TYPES:
        raise HTTPException(
            status_code=422, detail=f"doc_type must be one of {sorted(ALLOWED_DOC_TYPES)}"
        )

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=422, detail="Uploaded file is empty")

    content_hash = hashlib.sha256(raw).hexdigest()

    # Re-ingest idempotency (PLAN.md section 9): identical bytes in the same case is a no-op.
    existing = db.scalar(
        select(models.Document).where(
            models.Document.case_id == case_id,
            models.Document.content_hash == content_hash,
        )
    )
    if existing is not None:
        return existing

    doc = models.Document(
        case_id=case_id,
        filename=file.filename or "upload",
        doc_type=doc_type,
        content_hash=content_hash,
        status="pending",
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    background.add_task(process_document, doc.id, raw)
    return doc


@router.get("/{document_id}", response_model=DocumentDetail)
def get_document(case_id: int, document_id: int, db: Session = Depends(get_db)):
    doc = db.get(models.Document, document_id)
    if doc is None or doc.case_id != case_id:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc
