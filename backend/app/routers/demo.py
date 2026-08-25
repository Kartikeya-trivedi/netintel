"""Demo reset endpoint so a live demo can be re-run from a clean slate."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas import CaseOut

router = APIRouter(prefix="/api/demo", tags=["demo"])


@router.post("/reset", response_model=CaseOut)
def reset_demo(db: Session = Depends(get_db)):
    """Drop and re-seed the Operation Nightfall demo case (PLAN.md section 7)."""
    from app.seed.load_demo import reset_and_load

    return reset_and_load(db)
