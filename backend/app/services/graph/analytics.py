"""Network analytics: centrality, communities, paths, structural vulnerability.

Phase 3 (PLAN.md section 5.5). Consumed by routers.graph.

Metrics are cached per case and invalidated whenever an ingest completes.
Betweenness in particular is far too expensive to recompute per request.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.schemas import CommunityOut, KeyPlayer, PathOut, VulnerabilityReport

# case_id -> {metric_name: {entity_id: score}}
_METRIC_CACHE: dict[int, dict[str, dict[int, float]]] = {}


def invalidate_cache(case_id: int) -> None:
    """Drop cached metrics for a case. Called after every successful ingest."""
    _METRIC_CACHE.pop(case_id, None)


def compute_metrics(db: Session, case_id: int) -> dict[str, dict[int, float]]:
    """Compute degree, betweenness, eigenvector, and PageRank centrality.

    TODO(Phase 3): implement, populating _METRIC_CACHE. Guard eigenvector
    centrality with a try/except: it fails to converge on some disconnected
    graphs, and one failed metric should not take down the whole response.
    """
    raise NotImplementedError("Phase 3: see PLAN.md section 5.5")


def key_players(db: Session, case_id: int, *, metric: str, top: int) -> list[KeyPlayer]:
    """Top-N entities ranked by the requested centrality metric."""
    raise NotImplementedError("Phase 3: see PLAN.md section 5.5")


def communities(db: Session, case_id: int) -> list[CommunityOut]:
    """Louvain community detection over the case graph.

    TODO(Phase 3): nx.community.louvain_communities with a fixed seed, so the
    demo renders the same partition on every run.
    """
    raise NotImplementedError("Phase 3: see PLAN.md section 5.5")


def shortest_path(db: Session, case_id: int, source: int, target: int) -> PathOut:
    """Shortest path between two entities, with the evidence behind each hop."""
    raise NotImplementedError("Phase 3: see PLAN.md section 5.5")


def vulnerabilities(db: Session, case_id: int, *, top: int) -> VulnerabilityReport:
    """Articulation points plus key-player removal simulation.

    TODO(Phase 3): for each of the top-N nodes by betweenness, copy the graph,
    remove the node, and report component count and largest-component size
    before and after. This is what turns a centrality score into an operational
    recommendation about which arrest actually fragments the network.
    """
    raise NotImplementedError("Phase 3: see PLAN.md section 5.5")
