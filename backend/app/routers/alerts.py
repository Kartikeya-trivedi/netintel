"""Anomaly alert feed. Mounted at /api/cases/{case_id}/alerts."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.db import get_db
from app.schemas import AlertOut

router = APIRouter(prefix="/api/cases/{case_id}/alerts", tags=["alerts"])


@router.get("", response_model=list[AlertOut])
def list_alerts(
    case_id: int,
    severity: str | None = Query(None),
    alert_type: str | None = Query(None),
    status: str | None = Query(None),
    db: Session = Depends(get_db),
):
    stmt = select(models.Alert).where(models.Alert.case_id == case_id)
    if severity:
        stmt = stmt.where(models.Alert.severity == severity)
    if alert_type:
        stmt = stmt.where(models.Alert.alert_type == alert_type)
    if status:
        stmt = stmt.where(models.Alert.status == status)
    return db.scalars(stmt.order_by(models.Alert.created_at.desc())).all()


@router.patch("/{alert_id}", response_model=AlertOut)
def update_alert_status(
    case_id: int,
    alert_id: int,
    status: str = Query(..., pattern="^(open|reviewed)$"),
    db: Session = Depends(get_db),
):
    alert = db.get(models.Alert, alert_id)
    if alert is None or alert.case_id != case_id:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.status = status
    db.commit()
    db.refresh(alert)
    return alert
