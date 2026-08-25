"""Turn persisted entities and relationships into a NetworkX graph.

Phase 3 (PLAN.md section 5.5). Consumed by services.graph.analytics and
routers.graph.
"""

from __future__ import annotations

import networkx as nx
from sqlalchemy.orm import Session

from app.schemas import GraphOut


def build_nx_graph(
    db: Session,
    case_id: int,
    *,
    entity_types: list[str] | None = None,
    rel_types: list[str] | None = None,
) -> nx.Graph:
    """Build a weighted undirected graph of the case.

    Node keys are entity ids. Node attrs carry label and entity_type; edge attrs
    carry rel_type, weight, and evidence.

    TODO(Phase 3): implement.
      1. load Entity + Relationship rows for the case, applying filters
      2. project Transaction / CommEvent rows onto entity-to-entity edges where
         both sides resolved, so money and calls become graph structure
      3. collapse parallel edges, summing weight and concatenating evidence
    """
    raise NotImplementedError("Phase 3: see PLAN.md section 5.5")


def build_money_flow_digraph(db: Session, case_id: int) -> nx.DiGraph:
    """Directed graph of transactions only, for flow-of-funds views."""
    raise NotImplementedError("Phase 3: see PLAN.md section 5.5")


def build_graph_payload(
    db: Session,
    case_id: int,
    *,
    entity_types: list[str] | None = None,
    rel_types: list[str] | None = None,
) -> GraphOut:
    """Serialise the case graph into the Cytoscape-ready API payload.

    TODO(Phase 3): build the graph, attach cached metrics and community ids, and
    if node count exceeds settings.max_graph_nodes return the top-N by degree
    with truncated=True, so the browser stays responsive (PLAN.md section 9).
    """
    raise NotImplementedError("Phase 3: see PLAN.md section 5.5")
