"""Anomaly detection tests (PLAN.md section 5.6)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app import models
from app.config import get_settings
from app.services.anomaly import detector

BASE = datetime(2026, 3, 1, 10, 0, tzinfo=UTC)


def _txn(case_id: int, account: str, amount: float, day: int, *, ref: str = "T", to: str = "999"):
    return models.Transaction(
        case_id=case_id,
        txn_ref=ref,
        from_account=account,
        to_account=to,
        amount=amount,
        timestamp=BASE + timedelta(days=day),
    )


def _call(case_id: int, a: str, b: str, day: int, minute: int = 0):
    return models.CommEvent(
        case_id=case_id,
        caller=a,
        callee=b,
        timestamp=BASE + timedelta(days=day, minutes=minute),
        duration_sec=60,
    )


def test_structuring_detected_for_transfers_below_threshold(db_session, case):
    """Four transfers of Rs 48,000 in one week should read as smurfing."""
    for i in range(4):
        db_session.add(_txn(case.id, "ACC-1", 48_000, i, ref=f"S{i}"))
    db_session.commit()

    alerts = detector.detect_structuring(db_session, case.id)

    assert [a.alert_type for a in alerts] == ["STRUCTURING"]
    alert = alerts[0]
    assert alert.severity == "high"
    assert alert.evidence["count"] == 4
    assert alert.evidence["total"] == 192_000


def test_structuring_ignores_transfers_over_the_threshold(db_session, case):
    """Above the limit the transfer gets reported anyway, so it is not smurfing."""
    ceiling = get_settings().structuring_threshold
    for i in range(4):
        db_session.add(_txn(case.id, "ACC-1", ceiling + 5_000, i, ref=f"B{i}"))
    db_session.commit()

    assert detector.detect_structuring(db_session, case.id) == []


def test_structuring_ignores_transfers_outside_the_window(db_session, case):
    """Same amounts spread thin are ordinary business, not structuring."""
    window = get_settings().structuring_window_days
    for i in range(4):
        db_session.add(_txn(case.id, "ACC-1", 48_000, i * (window + 3), ref=f"W{i}"))
    db_session.commit()

    assert detector.detect_structuring(db_session, case.id) == []


def test_transaction_spike_detected(db_session, case):
    """A quiet account that moves 40x its usual day should be flagged."""
    for day in range(10):
        db_session.add(_txn(case.id, "ACC-2", 5_000 + day * 40, day, ref=f"N{day}"))
    db_session.add(_txn(case.id, "ACC-2", 200_000, 10, ref="SPIKE"))
    db_session.commit()

    alerts = detector.detect_transaction_spikes(db_session, case.id)

    assert len(alerts) == 1
    assert alerts[0].alert_type == "TRANSACTION_SPIKE"
    assert alerts[0].evidence["day_total"] == 200_000
    assert alerts[0].evidence["z_score"] >= get_settings().txn_spike_zscore
    assert all(a.severity in {"low", "medium", "high"} for a in alerts)


def test_no_spike_without_a_baseline(db_session, case):
    """Two days of history cannot establish what normal looks like."""
    db_session.add(_txn(case.id, "ACC-3", 5_000, 0, ref="A"))
    db_session.add(_txn(case.id, "ACC-3", 900_000, 1, ref="B"))
    db_session.commit()

    assert detector.detect_transaction_spikes(db_session, case.id) == []


def test_structured_days_do_not_also_raise_a_spike(db_session, case):
    """Smurfing is a spike too; reporting both buries the specific finding."""
    for day in range(8):
        db_session.add(_txn(case.id, "ACC-4", 4_000 + day * 30, day, ref=f"N{day}"))
    for i in range(4):
        db_session.add(_txn(case.id, "ACC-4", 48_000, 9 + i, ref=f"S{i}"))
    db_session.commit()

    alerts = detector.run_detection(db_session, case.id)
    types = {a.alert_type for a in alerts}

    assert "STRUCTURING" in types
    structured_days = detector._structuring_days(db_session, case.id)
    assert structured_days
    spike_days = {
        (a.evidence["account"], a.evidence["day"])
        for a in alerts
        if a.alert_type == "TRANSACTION_SPIKE"
    }
    assert spike_days.isdisjoint(structured_days)


def test_comm_burst_detected(db_session, case):
    """A pair that normally exchanges one call a day suddenly exchanging twenty."""
    for day in range(10):
        db_session.add(_call(case.id, "555000111", "555000222", day))
        if day % 3 == 0:
            db_session.add(_call(case.id, "555000222", "555000111", day, minute=30))
    for i in range(20):
        db_session.add(_call(case.id, "555000111", "555000222", 11, minute=i * 5))
    db_session.commit()

    alerts = detector.detect_comm_bursts(db_session, case.id)

    assert len(alerts) == 1
    assert alerts[0].alert_type == "COMM_BURST"
    assert alerts[0].evidence["count"] == 20


def test_comm_burst_ignores_direction(db_session, case):
    """Whoever dialled, the pair is the same pair."""
    for day in range(10):
        db_session.add(_call(case.id, "555000111", "555000222", day))
    for i in range(20):
        # Alternating direction must not split the burst across two baselines.
        a, b = ("555000111", "555000222") if i % 2 else ("555000222", "555000111")
        db_session.add(_call(case.id, a, b, 11, minute=i * 5))
    db_session.commit()

    alerts = detector.detect_comm_bursts(db_session, case.id)

    assert len(alerts) == 1
    assert alerts[0].evidence["count"] == 20


def test_detection_is_idempotent(db_session, case):
    """Detection re-runs after every upload; findings must not pile up."""
    for i in range(4):
        db_session.add(_txn(case.id, "ACC-5", 48_000, i, ref=f"S{i}"))
    db_session.commit()

    first = detector.run_detection(db_session, case.id)
    second = detector.run_detection(db_session, case.id)

    assert first, "expected the first pass to raise something"
    assert second == [], "a second pass must not re-raise settled findings"
    stored = db_session.query(models.Alert).filter_by(case_id=case.id).count()
    assert stored == len(first)


def test_centrality_shift_is_silent_on_the_first_pass(db_session, case):
    """Everyone is new on a first ingest, so flagging all five says nothing."""
    assert detector.detect_centrality_shifts(db_session, case.id) == []

    # The detector stages the baseline; persisting it is run_detection's job,
    # and the test session does not autoflush.
    db_session.commit()

    snapshot = (
        db_session.query(models.CaseSnapshot)
        .filter_by(case_id=case.id, key=detector.TOP_BETWEENNESS_SNAPSHOT)
        .one()
    )
    assert snapshot.payload == {"entity_ids": []}


def test_seeded_demo_case_raises_at_least_three_alerts(demo_case):
    """End-to-end safety net for the live demo (PLAN.md section 7).

    The ingest pipeline already runs detection per document, so this asserts on
    what landed in the table rather than on a fresh run's return value -- a
    second run is correctly a no-op.
    """
    session, case = demo_case

    alerts = session.query(models.Alert).filter_by(case_id=case.id).all()

    assert len(alerts) >= 3
    assert {a.alert_type for a in alerts} & {"STRUCTURING", "TRANSACTION_SPIKE", "COMM_BURST"}
    assert all(a.evidence.get("key") for a in alerts), "every alert needs a dedupe key"
