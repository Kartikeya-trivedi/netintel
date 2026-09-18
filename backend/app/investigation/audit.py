"""Hash-chained audit log of consequential actions.

Consumed by investigation.service and the investigation router.

Each event commits to the one before it, so removing or editing an event breaks
every hash after it. The chain head goes into exported finding packages as a
checkpoint. What this proves is limited and stated plainly: the log is
internally consistent from its first event. It does not prove the log was never
rebuilt from scratch; that needs checkpoints held by someone else, which is
what exporting the head is for.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.investigation.models import AuditEvent

GENESIS = "0" * 64


def _canonical(payload: dict) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode(
        "utf-8"
    )


def _digest(actor: str, action: str, target: str, detail: dict, at: str, prev: str) -> str:
    payload = {
        "actor": actor,
        "action": action,
        "target": target,
        "detail": detail,
        "at": at,
        "prev": prev,
    }
    return hashlib.sha256(_canonical(payload)).hexdigest()


def head(db: Session) -> str:
    last = db.scalar(select(AuditEvent).order_by(AuditEvent.id.desc()).limit(1))
    return last.hash if last else GENESIS


def record(
    db: Session, actor: str, action: str, target: str, detail: dict | None = None
) -> AuditEvent:
    """Append one event. Flushed, not committed: it lands with the change it records."""
    detail = json.loads(json.dumps(detail or {}, default=str))
    prev = head(db)
    at = datetime.now(UTC).isoformat(timespec="microseconds")
    event = AuditEvent(
        actor=actor,
        action=action,
        target=target,
        detail=detail,
        at=at,
        prev_hash=prev,
        hash=_digest(actor, action, target, detail, at, prev),
    )
    db.add(event)
    db.flush()
    return event


def verify_chain(db: Session) -> dict:
    """Recompute every link. Reports the first event that does not follow."""
    prev = GENESIS
    count = 0
    for event in db.scalars(select(AuditEvent).order_by(AuditEvent.id)):
        count += 1
        expected = _digest(
            event.actor, event.action, event.target, event.detail or {}, event.at, prev
        )
        if event.prev_hash != prev or event.hash != expected:
            return {"intact": False, "events": count, "head": prev, "broken_at": event.id}
        prev = event.hash
    return {"intact": True, "events": count, "head": prev, "broken_at": None}
