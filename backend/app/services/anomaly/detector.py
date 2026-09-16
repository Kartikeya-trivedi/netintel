"""Anomaly detection producing Alert rows (PLAN.md section 5.6).

Invoked by services.ingest.pipeline after each successful ingest, and by
seed.load_demo once the demo case is loaded.

Every detector is explainable by construction: each alert stores the rows that
triggered it, because an investigator has to be able to defend the flag.

Each alert also carries evidence["key"], a stable identity for the finding.
Detection re-runs after every upload, so without that key a three-file bulk
upload would raise the same structuring alert three times.
"""

from __future__ import annotations

import logging
import statistics
import threading
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.config import get_settings

logger = logging.getLogger(__name__)

# A spike is only meaningful against a baseline. Below this many active days
# there is nothing to be anomalous against, so the detector stays quiet rather
# than flagging the second day a case has ever seen.
MIN_BASELINE_DAYS = 5

# Scales the median absolute deviation so it estimates the standard deviation
# of a normal distribution, which is what makes the robust score comparable to
# the configured z-score threshold.
MAD_TO_SIGMA = 1.4826

# A burst has to be a burst. A pair that talks about once a day has a MAD of
# zero, and the fallback then scores a single extra call as an outlier; on the
# demo case that raised twenty "bursts" of two or three calls and buried the
# three real ones. Below this many calls a day is never flagged, however
# unusual it looks in relative terms.
MIN_BURST_CALLS = 5

# How far below the reporting threshold still counts as "deliberately under".
STRUCTURING_BAND = 0.10

MAX_EVIDENCE_ROWS = 12

# Uploads arrive as concurrent BackgroundTasks, so two detection runs can be in
# flight at once. Both would read "no existing keys" before either commits and
# raise the same finding twice. Serialising the whole pass is enough here
# because the API is single-process; a multi-worker deployment would need the
# dedupe key promoted to a real unique constraint instead.
_DETECTION_LOCK = threading.Lock()


def _aware(value: datetime) -> datetime:
    """SQLite hands back naive datetimes; comparing those to aware ones raises."""
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _robust_z(value: float, series: list[float]) -> float:
    """Deviation from the median, in MAD units.

    A plain mean/stdev z-score is the wrong tool here: the spike being hunted is
    itself in the sample, so it inflates the standard deviation and masks
    itself. With n days the largest attainable z is (n-1)/sqrt(n), which across
    a fortnight of data cannot even reach 3.0. The median and MAD are unmoved by
    the outlier, so a genuine spike scores as large as it really is.
    """
    med = statistics.median(series)
    mad = statistics.median([abs(x - med) for x in series])
    if mad > 0:
        return (value - med) / (MAD_TO_SIGMA * mad)
    # Every baseline day identical: fall back to spread around the mean.
    spread = statistics.pstdev(series)
    if spread > 0:
        return (value - statistics.fmean(series)) / spread
    return 0.0


def _existing_keys(db: Session, case_id: int) -> set[str]:
    rows = db.scalars(select(models.Alert).where(models.Alert.case_id == case_id)).all()
    return {
        row.evidence["key"]
        for row in rows
        if isinstance(row.evidence, dict) and row.evidence.get("key")
    }


def _owner_ids(*entity_ids: int | None) -> list[int]:
    """Entity ids behind an identifier, de-duplicated, nulls dropped."""
    seen: list[int] = []
    for value in entity_ids:
        if value is not None and value not in seen:
            seen.append(value)
    return seen


def _money(amount: float) -> str:
    return f"{amount:,.0f}"


def _score_text(score: float) -> str:
    """Human-readable robust z for an alert description.

    An account with a near-constant baseline has a tiny MAD, so one real spike
    can score in the thousands. That is arithmetically right and reads as a
    bug, so the description caps it; the exact value stays in the evidence.
    """
    return f"{score:.1f}" if score < 100 else "above 100"


# --- Transactions ------------------------------------------------------------


def detect_transaction_spikes(
    db: Session, case_id: int, covered: set[tuple[str, str]] | None = None
) -> list[models.Alert]:
    """Daily outbound totals per account; flag days above the z-score setting.

    Days already explained by a structuring alert are skipped. Smurfing shows up
    as a spike too, so without this every structured day is reported twice and
    the loud finding buries the specific one.
    """
    settings = get_settings()
    seen = _existing_keys(db, case_id)
    covered = covered or set()

    txns = db.scalars(
        select(models.Transaction).where(models.Transaction.case_id == case_id)
    ).all()
    if not txns:
        return []

    daily: dict[str, dict[date, float]] = defaultdict(lambda: defaultdict(float))
    rows_by_day: dict[tuple[str, date], list[models.Transaction]] = defaultdict(list)
    for txn in txns:
        day = _aware(txn.timestamp).date()
        daily[txn.from_account][day] += txn.amount
        rows_by_day[(txn.from_account, day)].append(txn)

    alerts: list[models.Alert] = []

    for account, by_day in daily.items():
        if len(by_day) < MIN_BASELINE_DAYS:
            continue
        totals = list(by_day.values())
        baseline = statistics.median(totals)

        for day, total in sorted(by_day.items()):
            score = _robust_z(total, totals)
            if score < settings.txn_spike_zscore:
                continue

            if (account, day.isoformat()) in covered:
                continue

            key = f"TXN_SPIKE:{account}:{day.isoformat()}"
            if key in seen:
                continue
            seen.add(key)

            rows = rows_by_day[(account, day)]
            alerts.append(
                models.Alert(
                    case_id=case_id,
                    alert_type="TRANSACTION_SPIKE",
                    severity="high" if score >= settings.txn_spike_zscore + 2 else "medium",
                    title=f"Account {account} moved {_money(total)} in one day",
                    description=(
                        f"{len(rows)} outbound transfer(s) on {day.isoformat()} totalling "
                        f"{_money(total)}, against a typical day of {_money(baseline)} for "
                        f"this account. Robust z-score {_score_text(score)}."
                    ),
                    entity_ids=_owner_ids(*[r.from_entity_id for r in rows]),
                    evidence={
                        "key": key,
                        "account": account,
                        "day": day.isoformat(),
                        "day_total": round(total, 2),
                        "baseline_median": round(baseline, 2),
                        "z_score": round(score, 2),
                        "threshold": settings.txn_spike_zscore,
                        "transactions": [
                            {
                                "txn_ref": r.txn_ref,
                                "to_account": r.to_account,
                                "amount": r.amount,
                                "timestamp": _aware(r.timestamp).isoformat(),
                            }
                            for r in rows[:MAX_EVIDENCE_ROWS]
                        ],
                    },
                )
            )

    return alerts


def detect_structuring(db: Session, case_id: int) -> list[models.Alert]:
    """Flag repeated transfers sitting just under the reporting threshold.

    Three or more transactions within 10 percent below settings.structuring_threshold
    from one account inside settings.structuring_window_days is the classic
    smurfing signature, and rates high severity.
    """
    settings = get_settings()
    seen = _existing_keys(db, case_id)

    ceiling = settings.structuring_threshold
    floor = ceiling * (1 - STRUCTURING_BAND)
    window = timedelta(days=settings.structuring_window_days)

    txns = db.scalars(
        select(models.Transaction).where(models.Transaction.case_id == case_id)
    ).all()

    by_account: dict[str, list[models.Transaction]] = defaultdict(list)
    for txn in txns:
        if floor <= txn.amount < ceiling:
            by_account[txn.from_account].append(txn)

    alerts: list[models.Alert] = []

    for account, rows in by_account.items():
        rows.sort(key=lambda r: _aware(r.timestamp))

        # Widest run of near-threshold transfers that fits inside the window.
        best: list[models.Transaction] = []
        start = 0
        for end in range(len(rows)):
            while _aware(rows[end].timestamp) - _aware(rows[start].timestamp) > window:
                start += 1
            if end - start + 1 > len(best):
                best = rows[start : end + 1]

        if len(best) < settings.structuring_min_count:
            continue

        first_day = _aware(best[0].timestamp).date()
        key = f"STRUCTURING:{account}:{first_day.isoformat()}"
        if key in seen:
            continue
        seen.add(key)

        total = sum(r.amount for r in best)
        span_days = (_aware(best[-1].timestamp) - _aware(best[0].timestamp)).days + 1

        alerts.append(
            models.Alert(
                case_id=case_id,
                alert_type="STRUCTURING",
                severity="high",
                title=f"Account {account} structured {_money(total)} below the reporting limit",
                description=(
                    f"{len(best)} transfers of {_money(floor)}-{_money(ceiling)} from this "
                    f"account inside {span_days} day(s), every one sitting under the "
                    f"{_money(ceiling)} reporting threshold. Splitting a single payment into "
                    f"several just-under transfers is the standard way to keep a report from "
                    f"being filed."
                ),
                entity_ids=_owner_ids(*[r.from_entity_id for r in best]),
                evidence={
                    "key": key,
                    "account": account,
                    "threshold": ceiling,
                    "band_floor": floor,
                    "window_days": settings.structuring_window_days,
                    "count": len(best),
                    "total": round(total, 2),
                    "transactions": [
                        {
                            "txn_ref": r.txn_ref,
                            "to_account": r.to_account,
                            "amount": r.amount,
                            "timestamp": _aware(r.timestamp).isoformat(),
                        }
                        for r in best[:MAX_EVIDENCE_ROWS]
                    ],
                },
            )
        )

    return alerts


# --- Communications ----------------------------------------------------------


def detect_comm_bursts(db: Session, case_id: int) -> list[models.Alert]:
    """Flag call-volume spikes for a number pair against its own baseline.

    Scored with the same robust z as transactions, against the same configured
    threshold: one dial for "how far from normal is worth an investigator's
    attention" reads better than two that drift apart.
    """
    settings = get_settings()
    seen = _existing_keys(db, case_id)

    events = db.scalars(
        select(models.CommEvent).where(models.CommEvent.case_id == case_id)
    ).all()
    if not events:
        return []

    # Direction is noise for burst detection: a flurry of calls between two
    # numbers matters whoever happened to dial.
    daily: dict[tuple[str, str], dict[date, int]] = defaultdict(lambda: defaultdict(int))
    rows_by_day: dict[tuple[str, str, date], list[models.CommEvent]] = defaultdict(list)
    for event in events:
        pair = tuple(sorted((event.caller, event.callee)))
        day = _aware(event.timestamp).date()
        daily[pair][day] += 1
        rows_by_day[(pair[0], pair[1], day)].append(event)

    alerts: list[models.Alert] = []

    for pair, by_day in daily.items():
        if len(by_day) < MIN_BASELINE_DAYS:
            continue
        counts = [float(c) for c in by_day.values()]
        baseline = statistics.median(counts)

        for day, count in sorted(by_day.items()):
            if count < MIN_BURST_CALLS:
                continue
            score = _robust_z(float(count), counts)
            if score < settings.txn_spike_zscore:
                continue

            key = f"COMM_BURST:{pair[0]}|{pair[1]}:{day.isoformat()}"
            if key in seen:
                continue
            seen.add(key)

            rows = rows_by_day[(pair[0], pair[1], day)]
            talk_time = sum(r.duration_sec or 0 for r in rows)

            alerts.append(
                models.Alert(
                    case_id=case_id,
                    alert_type="COMM_BURST",
                    severity="high" if score >= settings.txn_spike_zscore + 2 else "medium",
                    title=f"{count} calls between {pair[0]} and {pair[1]} in one day",
                    description=(
                        f"{count} calls on {day.isoformat()} totalling {talk_time // 60} "
                        f"minutes, against a typical {baseline:.0f} call(s) a day for this "
                        f"pair. Robust z-score {_score_text(score)}."
                    ),
                    entity_ids=_owner_ids(
                        *[r.caller_entity_id for r in rows],
                        *[r.callee_entity_id for r in rows],
                    ),
                    evidence={
                        "key": key,
                        "pair": list(pair),
                        "day": day.isoformat(),
                        "count": count,
                        "baseline_median": baseline,
                        "total_duration_sec": talk_time,
                        "z_score": round(score, 2),
                        "threshold": settings.txn_spike_zscore,
                        "calls": [
                            {
                                "caller": r.caller,
                                "callee": r.callee,
                                "timestamp": _aware(r.timestamp).isoformat(),
                                "duration_sec": r.duration_sec,
                            }
                            for r in rows[:MAX_EVIDENCE_ROWS]
                        ],
                    },
                )
            )

    return alerts


# --- Structure ---------------------------------------------------------------

TOP_BETWEENNESS_SNAPSHOT = "top_betweenness"
CENTRALITY_TOP_N = 5


def detect_centrality_shifts(db: Session, case_id: int) -> list[models.Alert]:
    """Flag entities newly entering the top-5 by betweenness after an ingest.

    Needs a before and an after, so the first run records the baseline and stays
    silent. That is the honest behaviour: on a case's first ingest everyone is
    new, and flagging all five would say nothing.
    """
    from app.services.graph import analytics

    seen = _existing_keys(db, case_id)

    players = analytics.key_players(db, case_id, metric="betweenness", top=CENTRALITY_TOP_N)
    current = [p for p in players if p.score > 0]
    current_ids = [p.entity_id for p in current]

    snapshot = db.scalar(
        select(models.CaseSnapshot).where(
            models.CaseSnapshot.case_id == case_id,
            models.CaseSnapshot.key == TOP_BETWEENNESS_SNAPSHOT,
        )
    )

    if snapshot is None:
        db.add(
            models.CaseSnapshot(
                case_id=case_id,
                key=TOP_BETWEENNESS_SNAPSHOT,
                payload={"entity_ids": current_ids},
            )
        )
        return []

    previous = set((snapshot.payload or {}).get("entity_ids", []))
    snapshot.payload = {"entity_ids": current_ids}
    snapshot.updated_at = datetime.now(UTC)

    alerts: list[models.Alert] = []

    for player in current:
        if player.entity_id in previous:
            continue
        key = f"CENTRALITY:{player.entity_id}:{player.rank}"
        if key in seen:
            continue
        seen.add(key)

        alerts.append(
            models.Alert(
                case_id=case_id,
                alert_type="HIGH_CENTRALITY_SHIFT",
                severity="medium",
                title=f"{player.name} entered the top {CENTRALITY_TOP_N} brokers",
                description=(
                    f"After this ingest {player.name} ranks {player.rank} by betweenness "
                    f"({player.score:.3f}), having been outside the top {CENTRALITY_TOP_N} "
                    f"before. New evidence moved them onto the paths between groups."
                ),
                entity_ids=[player.entity_id],
                evidence={
                    "key": key,
                    "entity_id": player.entity_id,
                    "rank": player.rank,
                    "score": round(player.score, 4),
                    "previous_top": sorted(previous),
                    "current_top": current_ids,
                },
            )
        )

    return alerts


# --- Orchestration -----------------------------------------------------------


def _structuring_days(db: Session, case_id: int) -> set[tuple[str, str]]:
    """(account, YYYY-MM-DD) pairs already explained by a structuring alert.

    Read back from the table rather than from this run's findings: the dedupe
    key means an established structuring alert is not re-raised, and its days
    still need suppressing on every later pass.
    """
    rows = db.scalars(
        select(models.Alert).where(
            models.Alert.case_id == case_id,
            models.Alert.alert_type == "STRUCTURING",
        )
    ).all()

    covered: set[tuple[str, str]] = set()
    for row in rows:
        evidence = row.evidence if isinstance(row.evidence, dict) else {}
        account = evidence.get("account")
        if not account:
            continue
        for txn in evidence.get("transactions", []):
            stamp = txn.get("timestamp")
            if stamp:
                covered.add((account, stamp[:10]))
    return covered


def run_detection(db: Session, case_id: int) -> list[models.Alert]:
    """Run every detector and persist the resulting alerts.

    Structuring runs before the spike detector so its findings can suppress the
    duplicate spike each structured day would otherwise raise.

    A detector that raises must not cost the case the other three, so each is
    isolated: the failure is logged and the rest still run.
    """
    alerts: list[models.Alert] = []

    def attempt(detector, *args) -> list[models.Alert]:
        try:
            found = detector(db, case_id, *args)
        except Exception:
            logger.exception("Detector %s failed for case %s", detector.__name__, case_id)
            db.rollback()
            return []
        for alert in found:
            db.add(alert)
        db.flush()
        alerts.extend(found)
        return found

    with _DETECTION_LOCK:
        # Re-read inside the lock: another ingest may have committed findings
        # between this call being scheduled and it actually running.
        db.expire_all()

        attempt(detect_structuring)
        attempt(detect_transaction_spikes, _structuring_days(db, case_id))
        attempt(detect_comm_bursts)
        attempt(detect_centrality_shifts)

        db.commit()

    if alerts:
        logger.info("Raised %s alert(s) for case %s", len(alerts), case_id)
    return alerts
