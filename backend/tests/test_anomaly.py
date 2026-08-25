"""Phase 5 anomaly detection tests."""

from __future__ import annotations

import pytest

from app.services.anomaly import detector


@pytest.mark.xfail(reason="Phase 5: detectors not implemented yet", strict=True)
def test_structuring_detected_for_transfers_below_threshold(db_session, case):
    """Four transfers of Rs 48,000 in one week should read as smurfing."""
    alerts = detector.detect_structuring(db_session, case.id)
    assert any(a.alert_type == "STRUCTURING" for a in alerts)


@pytest.mark.xfail(reason="Phase 5: detectors not implemented yet", strict=True)
def test_transaction_spike_detected(db_session, case):
    alerts = detector.detect_transaction_spikes(db_session, case.id)
    assert all(a.severity in {"low", "medium", "high"} for a in alerts)


@pytest.mark.xfail(reason="Phase 5: detectors not implemented yet", strict=True)
def test_seeded_demo_case_raises_at_least_three_alerts(db_session):
    """End-to-end safety net for the live demo (PLAN.md section 7)."""
    from app.seed.load_demo import reset_and_load

    demo_case = reset_and_load(db_session)
    alerts = detector.run_detection(db_session, demo_case.id)
    assert len(alerts) >= 3
