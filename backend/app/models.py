"""SQLAlchemy ORM models — the NetIntel data model (PLAN.md section 4).

Imported by app.db.init_db, all routers, and the service layer.

Provenance is a hard requirement: Mention rows carry document character spans,
Relationship.evidence carries {doc_id, snippet} pairs, and Alert.evidence carries
the source rows that triggered detection. Nothing surfaces in the UI without a
traceable origin.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def _utcnow() -> datetime:
    return datetime.now(UTC)


class Case(Base):
    __tablename__ = "cases"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    documents: Mapped[list[Document]] = relationship(
        back_populates="case", cascade="all, delete-orphan"
    )
    entities: Mapped[list[Entity]] = relationship(
        back_populates="case", cascade="all, delete-orphan"
    )
    # Reseeding the demo deletes the case. Without this the runs it owns are
    # left behind, and the next case to take this id inherits them.
    vision_runs: Mapped[list[VisionRun]] = relationship(
        back_populates="case", cascade="all, delete-orphan"
    )


class Document(Base):
    """An ingested source file: police report, transaction log, or call records."""

    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String(400), nullable=False)
    # report | transactions | call_records | subscriber_records
    doc_type: Mapped[str] = mapped_column(String(40), nullable=False)
    # sha256 of the uploaded bytes — makes re-ingest idempotent (PLAN.md section 9)
    content_hash: Mapped[str | None] = mapped_column(String(64), index=True)
    raw_text: Mapped[str | None] = mapped_column(Text)
    # pending | processing | processed | failed
    status: Mapped[str] = mapped_column(String(20), default="pending")
    error: Mapped[str | None] = mapped_column(Text)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    case: Mapped[Case] = relationship(back_populates="documents")
    mentions: Mapped[list[Mention]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )


class Entity(Base):
    """A resolved real-world entity. Aliases collapse into one canonical row."""

    __tablename__ = "entities"

    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    canonical_name: Mapped[str] = mapped_column(String(300), nullable=False)
    # PERSON | ORG | LOCATION | PHONE | BANK_ACCOUNT | VEHICLE | WEAPON | DRUG
    entity_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    aliases: Mapped[list[str]] = mapped_column(JSON, default=list)
    meta: Mapped[dict] = mapped_column(JSON, default=dict)
    first_seen_doc_id: Mapped[int | None] = mapped_column(ForeignKey("documents.id"))

    case: Mapped[Case] = relationship(back_populates="entities")
    mentions: Mapped[list[Mention]] = relationship(
        back_populates="entity", cascade="all, delete-orphan"
    )

    __table_args__ = (Index("ix_entity_case_name", "case_id", "canonical_name"),)


class Mention(Base):
    """A single textual occurrence of an entity — powers highlighting and provenance."""

    __tablename__ = "mentions"

    id: Mapped[int] = mapped_column(primary_key=True)
    entity_id: Mapped[int] = mapped_column(
        ForeignKey("entities.id", ondelete="CASCADE"), index=True
    )
    document_id: Mapped[int] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    span_start: Mapped[int] = mapped_column(Integer, nullable=False)
    span_end: Mapped[int] = mapped_column(Integer, nullable=False)
    surface_text: Mapped[str] = mapped_column(String(300), nullable=False)

    entity: Mapped[Entity] = relationship(back_populates="mentions")
    document: Mapped[Document] = relationship(back_populates="mentions")


class Relationship(Base):
    """A typed, weighted, evidence-backed link between two entities."""

    __tablename__ = "relationships"

    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    source_entity_id: Mapped[int] = mapped_column(
        ForeignKey("entities.id", ondelete="CASCADE"), index=True
    )
    target_entity_id: Mapped[int] = mapped_column(
        ForeignKey("entities.id", ondelete="CASCADE"), index=True
    )
    # ASSOCIATES_WITH | TRANSACTED_WITH | CALLED | LOCATED_AT | MEMBER_OF | OWNS
    rel_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    weight: Mapped[float] = mapped_column(Float, default=1.0)
    # list[{doc_id: int, snippet: str}]
    evidence: Mapped[list[dict]] = mapped_column(JSON, default=list)

    __table_args__ = (
        Index("ix_rel_case_pair", "case_id", "source_entity_id", "target_entity_id"),
    )


class Transaction(Base):
    """A financial transfer row from an ingested transactions CSV."""

    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    document_id: Mapped[int | None] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"))
    txn_ref: Mapped[str | None] = mapped_column(String(80))
    from_account: Mapped[str] = mapped_column(String(80), index=True)
    to_account: Mapped[str] = mapped_column(String(80), index=True)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    from_entity_id: Mapped[int | None] = mapped_column(ForeignKey("entities.id"))
    to_entity_id: Mapped[int | None] = mapped_column(ForeignKey("entities.id"))


class CommEvent(Base):
    """A call/communication record row from an ingested call-records CSV."""

    __tablename__ = "comm_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    document_id: Mapped[int | None] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"))
    caller: Mapped[str] = mapped_column(String(40), index=True)
    callee: Mapped[str] = mapped_column(String(40), index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    duration_sec: Mapped[int | None] = mapped_column(Integer)
    caller_entity_id: Mapped[int | None] = mapped_column(ForeignKey("entities.id"))
    callee_entity_id: Mapped[int | None] = mapped_column(ForeignKey("entities.id"))


class Alert(Base):
    """An anomaly flagged by the detection engine (PLAN.md section 5.6)."""

    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    # TRANSACTION_SPIKE | STRUCTURING | COMM_BURST | NEW_LINK | HIGH_CENTRALITY_SHIFT
    alert_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    severity: Mapped[str] = mapped_column(String(10), default="medium")  # low | medium | high
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    entity_ids: Mapped[list[int]] = mapped_column(JSON, default=list)
    evidence: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="open")  # open | reviewed
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class CaseSnapshot(Base):
    """Small key/value memory for detectors that compare against a previous run.

    detect_centrality_shifts needs a before and an after; without somewhere to
    keep the previous top-5 it could only ever report the current state, which
    is not a shift. Kept as its own table so create_all picks it up with no
    migration.
    """

    __tablename__ = "case_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    key: Mapped[str] = mapped_column(String(60), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    __table_args__ = (Index("ix_case_snapshot_case_key", "case_id", "key", unique=True),)


class VisionRun(Base):
    """One pass of the detector over a video upload or a camera grab.

    The run holds what was asked for and what came back in aggregate; the
    frames hold the pictures. Split in two because the frame strip is the
    expensive read and the run list is the cheap one.
    """

    __tablename__ = "vision_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    # video | cctv
    source_kind: Mapped[str] = mapped_column(String(20), nullable=False)
    # Upload filename, or the camera URL that was read.
    source_ref: Mapped[str] = mapped_column(String(500), nullable=False)
    # yolov8n | motion-fallback — which detector actually produced these boxes.
    engine: Mapped[str] = mapped_column(String(40), nullable=False)
    # pending | processing | processed | failed
    status: Mapped[str] = mapped_column(String(20), default="pending")
    error: Mapped[str | None] = mapped_column(Text)
    frame_count: Mapped[int] = mapped_column(Integer, default=0)
    detection_count: Mapped[int] = mapped_column(Integer, default=0)
    # list[{kind, severity, title, detail, frames: list[int]}]
    clues: Mapped[list[dict]] = mapped_column(JSON, default=list)
    # {frames, detections, labels: {label: count}, duration_sec}
    summary: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    case: Mapped[Case] = relationship(back_populates="vision_runs")
    frames: Mapped[list[VisionFrame]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="VisionFrame.frame_index",
    )


class VisionFrame(Base):
    """One sampled frame, its detections, and the annotated JPEG on disk."""

    __tablename__ = "vision_frames"

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(
        ForeignKey("vision_runs.id", ondelete="CASCADE"), index=True
    )
    frame_index: Mapped[int] = mapped_column(Integer, nullable=False)
    # Offset into the clip, or time since the first grab for a camera.
    timestamp_sec: Mapped[float] = mapped_column(Float, default=0.0)
    # Path relative to settings.evidence_store_dir, so moving the store does
    # not strand every frame ever written.
    image_path: Mapped[str] = mapped_column(String(500), nullable=False)
    # list[{label, confidence, box: [x1, y1, x2, y2], relevance}]
    detections: Mapped[list[dict]] = mapped_column(JSON, default=list)

    run: Mapped[VisionRun] = relationship(back_populates="frames")

    __table_args__ = (Index("ix_vision_frame_run_index", "run_id", "frame_index"),)
