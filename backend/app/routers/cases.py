"""Case CRUD and aggregate statistics. Mounted at /api/cases by app.main."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import models
from app.db import get_db
from app.schemas import CaseCreate, CaseOut, CaseStats

router = APIRouter(prefix="/api/cases", tags=["cases"])


@router.get("", response_model=list[CaseOut])
def list_cases(db: Session = Depends(get_db)):
    return db.scalars(select(models.Case).order_by(models.Case.created_at.desc())).all()


@router.post("", response_model=CaseOut, status_code=201)
def create_case(payload: CaseCreate, db: Session = Depends(get_db)):
    case = models.Case(name=payload.name, description=payload.description)
    db.add(case)
    db.commit()
    db.refresh(case)
    return case


@router.get("/{case_id}", response_model=CaseOut)
def get_case(case_id: int, db: Session = Depends(get_db)):
    case = db.get(models.Case, case_id)
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")
    return case


@router.delete("/{case_id}", status_code=204)
def delete_case(case_id: int, db: Session = Depends(get_db)):
    case = db.get(models.Case, case_id)
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")
    db.delete(case)
    db.commit()


@router.get("/{case_id}/stats", response_model=CaseStats)
def case_stats(case_id: int, db: Session = Depends(get_db)):
    if db.get(models.Case, case_id) is None:
        raise HTTPException(status_code=404, detail="Case not found")

    def count(model, *extra) -> int:
        stmt = select(func.count()).select_from(model).where(model.case_id == case_id, *extra)
        return db.scalar(stmt) or 0

    return CaseStats(
        case_id=case_id,
        documents=count(models.Document),
        entities=count(models.Entity),
        relationships=count(models.Relationship),
        transactions=count(models.Transaction),
        comm_events=count(models.CommEvent),
        open_alerts=count(models.Alert, models.Alert.status == "open"),
    )
