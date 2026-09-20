"""Pydantic request/response schemas for the public API.

Imported by every router in app.routers.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --- Cases -------------------------------------------------------------------


class CaseCreate(BaseModel):
    name: str
    description: str | None = None


class CaseOut(ORMModel):
    id: int
    name: str
    description: str | None
    created_at: datetime


class CaseStats(BaseModel):
    case_id: int
    documents: int
    entities: int
    relationships: int
    transactions: int
    comm_events: int
    open_alerts: int


# --- Documents ---------------------------------------------------------------


class MentionOut(ORMModel):
    id: int
    entity_id: int
    span_start: int
    span_end: int
    surface_text: str


class DocumentOut(ORMModel):
    id: int
    case_id: int
    filename: str
    doc_type: str
    status: str
    error: str | None
    uploaded_at: datetime


class DocumentDetail(DocumentOut):
    raw_text: str | None
    mentions: list[MentionOut] = []


# --- Entities ----------------------------------------------------------------


class EntityOut(ORMModel):
    id: int
    case_id: int
    canonical_name: str
    entity_type: str
    aliases: list[str]
    meta: dict


class EntityProfile(EntityOut):
    """Full dossier backing the entity profile page."""

    metrics: dict[str, float] = {}
    community_id: int | None = None
    mention_count: int = 0
    related_alert_ids: list[int] = []


# --- Graph -------------------------------------------------------------------


class GraphNode(BaseModel):
    id: str
    label: str
    entity_type: str
    metrics: dict[str, float] = {}
    community_id: int | None = None


class GraphEdge(BaseModel):
    id: str
    source: str
    target: str
    rel_type: str
    weight: float
    evidence: list[dict] = []


class GraphOut(BaseModel):
    """Cytoscape-ready payload consumed by components/NetworkGraph.tsx."""

    case_id: int
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    truncated: bool = False
    total_nodes: int = 0


class KeyPlayer(BaseModel):
    entity_id: int
    name: str
    entity_type: str
    metric: str
    score: float
    rank: int


class CommunityOut(BaseModel):
    community_id: int
    size: int
    member_entity_ids: list[int]
    dominant_entity_type: str
    top_member: str


class PathOut(BaseModel):
    found: bool
    entity_ids: list[int] = []
    names: list[str] = []
    edges: list[GraphEdge] = []
    hops: int = 0


class RemovalImpact(BaseModel):
    """Result of simulating removal of a key player (PLAN.md section 5.5)."""

    entity_id: int
    name: str
    components_before: int
    components_after: int
    largest_component_before: int
    largest_component_after: int
    fragmentation_delta: float


class VulnerabilityReport(BaseModel):
    articulation_point_entity_ids: list[int]
    removal_impacts: list[RemovalImpact]


# --- Alerts ------------------------------------------------------------------


class AlertOut(ORMModel):
    id: int
    case_id: int
    alert_type: str
    severity: str
    title: str
    description: str | None
    entity_ids: list[int]
    evidence: dict
    status: str
    created_at: datetime


# --- Search ------------------------------------------------------------------


class SearchHit(BaseModel):
    kind: str  # entity | document | alert
    id: int
    label: str
    detail: str | None = None

# --- Vision (CCTV stills and uploaded video) ---------------------------------


class VisionFrameOut(ORMModel):
    id: int
    frame_index: int
    timestamp_sec: float
    detections: list[dict]


class VisionRunOut(ORMModel):
    id: int
    case_id: int
    source_kind: str
    source_ref: str
    engine: str
    status: str
    error: str | None
    frame_count: int
    detection_count: int
    clues: list[dict]
    summary: dict
    created_at: datetime


class VisionRunDetail(VisionRunOut):
    frames: list[VisionFrameOut]


class CameraGrab(BaseModel):
    """A camera to read. `frames` is clamped server-side."""

    url: str
    frames: int = 4
