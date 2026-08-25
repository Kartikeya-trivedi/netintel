"""Graph construction and analytics endpoints (PLAN.md section 5.5).

All responses are Cytoscape-ready so the frontend can render without reshaping.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas import CommunityOut, GraphOut, KeyPlayer, PathOut, VulnerabilityReport
from app.services.graph import analytics, builder

router = APIRouter(prefix="/api/cases/{case_id}/graph", tags=["graph"])


@router.get("", response_model=GraphOut)
def get_graph(
    case_id: int,
    entity_types: str | None = Query(None, description="Comma-separated entity type filter"),
    rel_types: str | None = Query(None, description="Comma-separated relationship type filter"),
    db: Session = Depends(get_db),
):
    types = entity_types.split(",") if entity_types else None
    rels = rel_types.split(",") if rel_types else None
    return builder.build_graph_payload(db, case_id, entity_types=types, rel_types=rels)


@router.get("/metrics", response_model=list[KeyPlayer])
def get_metrics(
    case_id: int,
    metric: str = Query("betweenness", pattern="^(degree|betweenness|eigenvector|pagerank)$"),
    top: int = Query(10, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Ranked key players. Betweenness is the default: it surfaces brokers who
    bridge otherwise separate cells, which is how a low-visibility coordinator
    becomes detectable."""
    return analytics.key_players(db, case_id, metric=metric, top=top)


@router.get("/communities", response_model=list[CommunityOut])
def get_communities(case_id: int, db: Session = Depends(get_db)):
    return analytics.communities(db, case_id)


@router.get("/path", response_model=PathOut)
def get_path(
    case_id: int,
    source: int = Query(..., description="Source entity id"),
    target: int = Query(..., description="Target entity id"),
    db: Session = Depends(get_db),
):
    if source == target:
        raise HTTPException(status_code=422, detail="source and target must differ")
    return analytics.shortest_path(db, case_id, source, target)


@router.get("/vulnerabilities", response_model=VulnerabilityReport)
def get_vulnerabilities(
    case_id: int,
    top: int = Query(5, ge=1, le=25),
    db: Session = Depends(get_db),
):
    """Articulation points plus key-player removal simulation."""
    return analytics.vulnerabilities(db, case_id, top=top)
