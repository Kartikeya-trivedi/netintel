"""Entity listing and dossier profiles. Mounted at /api/cases/{case_id}/entities."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.db import get_db
from app.schemas import EntityOut, EntityProfile

router = APIRouter(prefix="/api/cases/{case_id}/entities", tags=["entities"])


@router.get("", response_model=list[EntityOut])
def list_entities(
    case_id: int,
    entity_type: str | None = Query(None),
    db: Session = Depends(get_db),
):
    stmt = select(models.Entity).where(models.Entity.case_id == case_id)
    if entity_type:
        stmt = stmt.where(models.Entity.entity_type == entity_type)
    return db.scalars(stmt.order_by(models.Entity.canonical_name)).all()


@router.get("/{entity_id}", response_model=EntityProfile)
def get_entity(case_id: int, entity_id: int, db: Session = Depends(get_db)):
    entity = db.get(models.Entity, entity_id)
    if entity is None or entity.case_id != case_id:
        raise HTTPException(status_code=404, detail="Entity not found")

    # TODO(Phase 3/6): fill metrics + community_id from services.graph.analytics
    # and related_alert_ids from the Alert table.
    profile = EntityProfile.model_validate(entity)
    profile.mention_count = len(entity.mentions)
    return profile
