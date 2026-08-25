"""Turn persisted entities and relationships into a NetworkX graph.

Consumed by services.graph.analytics and routers.graph.
"""

from __future__ import annotations

from collections import defaultdict

import networkx as nx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.config import get_settings
from app.schemas import GraphEdge, GraphNode, GraphOut

# Structured records become graph edges too. A transfer or a call is a stronger
# statement about a relationship than a sentence that merely names two people
# together, so projected edges carry their own type rather than being folded
# into generic association.
TRANSACTION_REL_TYPE = "TRANSACTED_WITH"
COMM_REL_TYPE = "CALLED"


def build_nx_graph(
    db: Session,
    case_id: int,
    *,
    entity_types: list[str] | None = None,
    rel_types: list[str] | None = None,
) -> nx.Graph:
    """Build a weighted undirected graph of the case.

    Node keys are entity ids. Node attributes carry label and entity_type; edge
    attributes carry rel_type, weight, and evidence.
    """
    graph = nx.Graph()

    entity_query = select(models.Entity).where(models.Entity.case_id == case_id)
    if entity_types:
        entity_query = entity_query.where(models.Entity.entity_type.in_(entity_types))
    entities = db.scalars(entity_query).all()

    for entity in entities:
        graph.add_node(
            entity.id,
            label=entity.canonical_name,
            entity_type=entity.entity_type,
            aliases=entity.aliases or [],
        )

    present = set(graph.nodes)

    rel_query = select(models.Relationship).where(models.Relationship.case_id == case_id)
    if rel_types:
        rel_query = rel_query.where(models.Relationship.rel_type.in_(rel_types))

    for rel in db.scalars(rel_query).all():
        if rel.source_entity_id not in present or rel.target_entity_id not in present:
            continue
        _merge_edge(
            graph,
            rel.source_entity_id,
            rel.target_entity_id,
            rel.rel_type,
            float(rel.weight or 1.0),
            list(rel.evidence or []),
        )

    _project_records(db, case_id, graph, present, rel_types)
    return graph


def _merge_edge(
    graph: nx.Graph,
    source: int,
    target: int,
    rel_type: str,
    weight: float,
    evidence: list[dict],
) -> None:
    """Collapse parallel edges, summing weight and keeping the evidence."""
    if source == target:
        return

    if graph.has_edge(source, target):
        data = graph[source][target]
        data["weight"] = data.get("weight", 0.0) + weight
        data["evidence"] = [*data.get("evidence", []), *evidence][:8]
        # A typed edge is more informative than a generic association, so it
        # wins the label when both kinds exist between the same pair.
        if data.get("rel_type") == "ASSOCIATES_WITH" and rel_type != "ASSOCIATES_WITH":
            data["rel_type"] = rel_type
    else:
        graph.add_edge(source, target, rel_type=rel_type, weight=weight, evidence=evidence[:8])


def _project_records(
    db: Session,
    case_id: int,
    graph: nx.Graph,
    present: set[int],
    rel_types: list[str] | None,
) -> None:
    """Fold linked transactions and call records into entity-to-entity edges."""
    if rel_types is None or TRANSACTION_REL_TYPE in rel_types:
        totals: dict[tuple[int, int], list[float]] = defaultdict(lambda: [0.0, 0.0])
        rows = db.scalars(
            select(models.Transaction).where(
                models.Transaction.case_id == case_id,
                models.Transaction.from_entity_id.isnot(None),
                models.Transaction.to_entity_id.isnot(None),
            )
        ).all()
        for row in rows:
            if row.from_entity_id in present and row.to_entity_id in present:
                bucket = totals[(row.from_entity_id, row.to_entity_id)]
                bucket[0] += 1
                bucket[1] += float(row.amount or 0.0)

        for (source, target), (count, amount) in totals.items():
            _merge_edge(
                graph,
                source,
                target,
                TRANSACTION_REL_TYPE,
                count,
                [{"summary": f"{int(count)} transfers totalling Rs. {amount:,.0f}"}],
            )

    if rel_types is None or COMM_REL_TYPE in rel_types:
        counts: dict[tuple[int, int], int] = defaultdict(int)
        rows = db.scalars(
            select(models.CommEvent).where(
                models.CommEvent.case_id == case_id,
                models.CommEvent.caller_entity_id.isnot(None),
                models.CommEvent.callee_entity_id.isnot(None),
            )
        ).all()
        for row in rows:
            if row.caller_entity_id in present and row.callee_entity_id in present:
                counts[(row.caller_entity_id, row.callee_entity_id)] += 1

        for (source, target), count in counts.items():
            _merge_edge(
                graph,
                source,
                target,
                COMM_REL_TYPE,
                float(count),
                [{"summary": f"{count} calls exchanged"}],
            )


def build_money_flow_digraph(db: Session, case_id: int) -> nx.DiGraph:
    """Directed graph of transactions only, for flow-of-funds views."""
    graph = nx.DiGraph()
    rows = db.scalars(
        select(models.Transaction).where(
            models.Transaction.case_id == case_id,
            models.Transaction.from_entity_id.isnot(None),
            models.Transaction.to_entity_id.isnot(None),
        )
    ).all()

    for row in rows:
        source, target = row.from_entity_id, row.to_entity_id
        if graph.has_edge(source, target):
            graph[source][target]["amount"] += float(row.amount or 0.0)
            graph[source][target]["count"] += 1
        else:
            graph.add_edge(source, target, amount=float(row.amount or 0.0), count=1)
    return graph


def build_graph_payload(
    db: Session,
    case_id: int,
    *,
    entity_types: list[str] | None = None,
    rel_types: list[str] | None = None,
) -> GraphOut:
    """Serialise the case graph into the Cytoscape-ready API payload."""
    from app.services.graph import analytics

    graph = build_nx_graph(db, case_id, entity_types=entity_types, rel_types=rel_types)
    total_nodes = graph.number_of_nodes()

    settings = get_settings()
    truncated = total_nodes > settings.max_graph_nodes
    if truncated:
        # Keep the best-connected slice rather than an arbitrary one: a browser
        # cannot lay out thousands of nodes usefully, and the periphery is the
        # least informative part to drop.
        keep = sorted(graph.degree, key=lambda pair: pair[1], reverse=True)
        graph = graph.subgraph(node for node, _ in keep[: settings.max_graph_nodes]).copy()

    metrics = analytics.compute_metrics(db, case_id)
    communities = analytics.community_index(db, case_id)

    nodes = [
        GraphNode(
            id=str(node_id),
            label=data.get("label", str(node_id)),
            entity_type=data.get("entity_type", "PERSON"),
            metrics={name: round(scores.get(node_id, 0.0), 6) for name, scores in metrics.items()},
            community_id=communities.get(node_id),
        )
        for node_id, data in graph.nodes(data=True)
    ]

    edges = [
        GraphEdge(
            id=f"{source}-{target}",
            source=str(source),
            target=str(target),
            rel_type=data.get("rel_type", "ASSOCIATES_WITH"),
            weight=float(data.get("weight", 1.0)),
            evidence=list(data.get("evidence", [])),
        )
        for source, target, data in graph.edges(data=True)
    ]

    return GraphOut(
        case_id=case_id,
        nodes=nodes,
        edges=edges,
        truncated=truncated,
        total_nodes=total_nodes,
    )
