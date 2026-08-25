"""Anomaly detection producing Alert rows (PLAN.md section 5.6).

Phase 5. Invoked by services.ingest.pipeline after each successful ingest.

Every detector is explainable by construction: each alert stores the rows that
triggered it, because an investigator has to be able to defend the flag.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app import models


def detect_transaction_spikes(db: Session, case_id: int) -> list[models.Alert]:
    """Daily totals per account; flag z-score above settings.txn_spike_zscore."""
    raise NotImplementedError("Phase 5: see PLAN.md section 5.6")


def detect_structuring(db: Session, case_id: int) -> list[models.Alert]:
    """Flag repeated transfers sitting just under the reporting threshold.

    Three or more transactions within 10 percent below settings.structuring_threshold
    from one account inside settings.structuring_window_days is the classic
    smurfing signature, and rates high severity.
    """
    raise NotImplementedError("Phase 5: see PLAN.md section 5.6")


def detect_comm_bursts(db: Session, case_id: int) -> list[models.Alert]:
    """Flag call-volume spikes for a number pair against its own baseline."""
    raise NotImplementedError("Phase 5: see PLAN.md section 5.6")


def detect_centrality_shifts(db: Session, case_id: int) -> list[models.Alert]:
    """Flag entities newly entering the top-5 by betweenness after an ingest."""
    raise NotImplementedError("Phase 5: see PLAN.md section 5.6")


def run_detection(db: Session, case_id: int) -> list[models.Alert]:
    """Run every detector and persist the resulting alerts."""
    alerts: list[models.Alert] = []
    for detector in (
        detect_transaction_spikes,
        detect_structuring,
        detect_comm_bursts,
        detect_centrality_shifts,
    ):
        alerts.extend(detector(db, case_id))
    db.commit()
    return alerts
