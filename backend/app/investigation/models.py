"""ORM tables for the investigation layer. Additive: no existing table changes.

Registered by app.db.init_db. Every table here is new, so create_all adds them
to an existing database without a migration, the same trick the older
CaseSnapshot table relies on.

Two rules shape the columns. Times that feed the engine or a hash are stored
as UTC ISO-8601 strings, because SQLite drops time zones from DateTime values
and a hash must not depend on how a driver round-trips a timestamp. Decisions
are append-only: a correction is a new row, and the previous one stays.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def _utcnow() -> datetime:
    return datetime.now(UTC)


class CaseProfile(Base):
    """A stable code and owning agency for a case.

    Engine keys use the code, never the database id, so a finding computed in
    one deployment reproduces in another where the ids differ.
    """

    __tablename__ = "case_profiles"

    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(
        ForeignKey("cases.id", ondelete="CASCADE"), unique=True, index=True
    )
    code: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    agency: Mapped[str | None] = mapped_column(String(200))


class EvidenceArtifact(Base):
    """One received original, preserved before anything parsed it."""

    __tablename__ = "evidence_artifacts"

    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    document_id: Mapped[int | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL"), index=True
    )
    sha256: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    filename: Mapped[str] = mapped_column(String(400), nullable=False)
    kind: Mapped[str] = mapped_column(String(40), nullable=False)
    byte_size: Mapped[int] = mapped_column(Integer, nullable=False)
    source_org: Mapped[str | None] = mapped_column(String(200))
    # received | parsed | failed. Received means the bytes are safe on disk.
    status: Mapped[str] = mapped_column(String(20), default="received")
    error: Mapped[str | None] = mapped_column(Text)
    extractor_version: Mapped[str | None] = mapped_column(String(60))
    reference: Mapped[str | None] = mapped_column(String(200))
    source_reference: Mapped[str | None] = mapped_column(String(200))
    document_date: Mapped[str | None] = mapped_column(String(40))
    title: Mapped[str | None] = mapped_column(String(300))
    warnings: Mapped[list[str]] = mapped_column(JSON, default=list)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    __table_args__ = (UniqueConstraint("case_id", "sha256", name="uq_artifact_case_sha"),)


class EvidenceItem(Base):
    """A row or passage inside an original, with its exact text."""

    __tablename__ = "evidence_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    artifact_id: Mapped[int] = mapped_column(
        ForeignKey("evidence_artifacts.id", ondelete="CASCADE"), index=True
    )
    locator_key: Mapped[str] = mapped_column(String(60), nullable=False)
    locator: Mapped[dict] = mapped_column(JSON, default=dict)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    content_sha256: Mapped[str] = mapped_column(String(64), nullable=False)

    __table_args__ = (UniqueConstraint("artifact_id", "locator_key", name="uq_item_locator"),)


class AssertionRow(Base):
    """A typed statement extracted from one evidence item. Never edited."""

    __tablename__ = "assertions"

    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    artifact_id: Mapped[int] = mapped_column(
        ForeignKey("evidence_artifacts.id", ondelete="CASCADE"), index=True
    )
    key: Mapped[str] = mapped_column(String(40), unique=True, index=True, nullable=False)
    item: Mapped[str] = mapped_column(String(60), nullable=False)
    predicate: Mapped[str] = mapped_column(String(20), nullable=False)
    subject: Mapped[str] = mapped_column(String(200), nullable=False)
    object: Mapped[str | None] = mapped_column(String(200))
    starts_at: Mapped[str | None] = mapped_column(String(40))
    ends_at: Mapped[str | None] = mapped_column(String(40))
    polarity: Mapped[int] = mapped_column(Integer, default=1)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    detail: Mapped[str | None] = mapped_column(String(160))
    amount: Mapped[float | None] = mapped_column(Float)
    subject_label: Mapped[str | None] = mapped_column(String(300))
    object_label: Mapped[str | None] = mapped_column(String(300))
    text: Mapped[str] = mapped_column(Text, default="")


class Principal(Base):
    """Someone who acts in the system. Demo identity only: no authentication."""

    __tablename__ = "principals"

    id: Mapped[int] = mapped_column(primary_key=True)
    handle: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    # investigator | reviewer | custodian | administrator
    role: Mapped[str] = mapped_column(String(40), nullable=False)


class CaseGrant(Base):
    """Permission for one principal to read one case, for a stated purpose."""

    __tablename__ = "case_grants"

    id: Mapped[int] = mapped_column(primary_key=True)
    principal_id: Mapped[int] = mapped_column(
        ForeignKey("principals.id", ondelete="CASCADE"), index=True
    )
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    purpose: Mapped[str] = mapped_column(String(300), nullable=False)
    granted_by: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Workspace(Base):
    """Authorised cases compared for one purpose. Decisions live here."""

    __tablename__ = "workspaces"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    purpose: Mapped[str] = mapped_column(String(300), nullable=False)
    principal_id: Mapped[int] = mapped_column(
        ForeignKey("principals.id", ondelete="CASCADE"), index=True
    )
    case_ids: Mapped[list[int]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    # Incremented by every decision. Optimistic concurrency and finding history
    # both key on it.
    decision_version: Mapped[int] = mapped_column(Integer, default=0)


class AssertionReview(Base):
    __tablename__ = "assertion_reviews"

    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    assertion_key: Mapped[str] = mapped_column(String(40), index=True, nullable=False)
    # proposed | accepted | disputed | rejected. Accepted means an analyst
    # accepted the reading of the source, not that the allegation is proven.
    state: Mapped[str] = mapped_column(String(20), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    actor_id: Mapped[int] = mapped_column(ForeignKey("principals.id"))
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class IdentityDecisionRow(Base):
    __tablename__ = "identity_decisions"

    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    candidate_key: Mapped[str] = mapped_column(String(40), index=True, nullable=False)
    person_a: Mapped[str] = mapped_column(String(200), nullable=False)
    person_b: Mapped[str] = mapped_column(String(200), nullable=False)
    # accepted | rejected | deferred
    state: Mapped[str] = mapped_column(String(20), nullable=False)
    evidence_keys: Mapped[list[str]] = mapped_column(JSON, default=list)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    actor_id: Mapped[int] = mapped_column(ForeignKey("principals.id"))
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class GroupingDecision(Base):
    __tablename__ = "grouping_decisions"

    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    link_key: Mapped[str] = mapped_column(String(40), index=True, nullable=False)
    # accepted | rejected
    state: Mapped[str] = mapped_column(String(20), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    actor_id: Mapped[int] = mapped_column(ForeignKey("principals.id"))
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class ScenarioRun(Base):
    """A challenge scenario and its comparison with the baseline it pinned."""

    __tablename__ = "scenario_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    definition: Mapped[dict] = mapped_column(JSON, default=dict)
    baseline_version: Mapped[int] = mapped_column(Integer, nullable=False)
    # queued | running | complete | failed. A failed run never shows baseline
    # results in place of its own.
    status: Mapped[str] = mapped_column(String(20), default="queued")
    result: Mapped[dict | None] = mapped_column(JSON)
    error: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int] = mapped_column(ForeignKey("principals.id"))
    idempotency_key: Mapped[str | None] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    __table_args__ = (Index("ix_scenario_idem", "workspace_id", "created_by", "idempotency_key"),)


class FindingSnapshot(Base):
    """What every finding looked like at one decision version, and why it moved."""

    __tablename__ = "finding_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("principals.id"))
    summary: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    __table_args__ = (UniqueConstraint("workspace_id", "version", name="uq_snapshot_version"),)


class AuditEvent(Base):
    """One link of a hash chain over everything consequential that happened."""

    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    actor: Mapped[str] = mapped_column(String(80), nullable=False)
    action: Mapped[str] = mapped_column(String(60), nullable=False)
    target: Mapped[str] = mapped_column(String(200), nullable=False)
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    at: Mapped[str] = mapped_column(String(40), nullable=False)
    prev_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
