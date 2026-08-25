"""Cross-entity search powering the Graph Explorer focus box."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.db import get_db
from app.schemas import SearchHit

router = APIRouter(prefix="/api/cases/{case_id}/search", tags=["search"])


@router.get("", response_model=list[SearchHit])
def search(
    case_id: int,
    q: str = Query(..., min_length=1),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    pattern = f"%{q}%"
    hits: list[SearchHit] = []

    entities = db.scalars(
        select(models.Entity)
        .where(models.Entity.case_id == case_id, models.Entity.canonical_name.ilike(pattern))
        .limit(limit)
    ).all()
    hits += [
        SearchHit(kind="entity", id=e.id, label=e.canonical_name, detail=e.entity_type)
        for e in entities
    ]

    docs = db.scalars(
        select(models.Document)
        .where(models.Document.case_id == case_id, models.Document.filename.ilike(pattern))
        .limit(limit)
    ).all()
    hits += [
        SearchHit(kind="document", id=d.id, label=d.filename, detail=d.doc_type) for d in docs
    ]

    return hits[:limit]
