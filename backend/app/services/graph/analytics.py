"""Network analytics: centrality, communities, paths, structural vulnerability.

Consumed by routers.graph.

Metrics are cached per case and invalidated whenever an ingest completes.
Betweenness is far too expensive to recompute on every request.
"""

from __future__ import annotations

import logging

import networkx as nx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.schemas import (
    CommunityOut,
    GraphEdge,
    KeyPlayer,
    PathOut,
    RemovalImpact,
    VulnerabilityReport,
)
from app.services.graph.builder import build_nx_graph

logger = logging.getLogger(__name__)

# Fixed seed so the demo renders the same partition on every run.
LOUVAIN_SEED = 42

METRIC_NAMES = ("degree", "betweenness", "eigenvector", "pagerank")

# Centrality is computed over actors only. Places, phones, and accounts are
# attributes of people, not participants: a location named in reports from three
# different cells would otherwise become the graph's busiest bridge and outrank
# the person those cells actually route through. Filtering to actors asks the
# question an investigator means -- who is central among the people.
ACTOR_ENTITY_TYPES = ["PERSON"]

# case_id -> {metric_name: {entity_id: score}}
_METRIC_CACHE: dict[int, dict[str, dict[int, float]]] = {}
# case_id -> {entity_id: community_id}
_COMMUNITY_CACHE: dict[int, dict[int, int]] = {}


def invalidate_cache(case_id: int) -> None:
    """Drop cached analytics for a case. Called after every successful ingest."""
    _METRIC_CACHE.pop(case_id, None)
    _COMMUNITY_CACHE.pop(case_id, None)


def clear_all_caches() -> None:
    """Drop every cached metric and partition.

    The caches are keyed by case id alone, which is sound against a single
    database but not across two. Tests that swap the database underneath the
    process must reset them explicitly.
    """
    _METRIC_CACHE.clear()
    _COMMUNITY_CACHE.clear()


def compute_metrics(db: Session, case_id: int) -> dict[str, dict[int, float]]:
    """Compute degree, betweenness, eigenvector, and PageRank centrality."""
    cached = _METRIC_CACHE.get(case_id)
    if cached is not None:
        return cached

    graph = build_nx_graph(db, case_id, entity_types=ACTOR_ENTITY_TYPES)
    if graph.number_of_nodes() == 0:
        return {name: {} for name in METRIC_NAMES}

    metrics: dict[str, dict[int, float]] = {
        "degree": nx.degree_centrality(graph),
        # Unweighted by design: betweenness should measure structural position,
        # not how chatty a pair is. Weighting it lets call volume drown out the
        # brokerage role that actually matters.
        "betweenness": nx.betweenness_centrality(graph),
        "pagerank": nx.pagerank(graph, weight="weight"),
    }

    metrics["eigenvector"] = _eigenvector(graph, case_id)

    _METRIC_CACHE[case_id] = metrics
    return metrics


def _eigenvector(graph: nx.Graph, case_id: int) -> dict[int, float]:
    """Eigenvector centrality, computed on the largest connected component.

    The measure is undefined across disconnected components -- scores in one
    component say nothing about another -- so networkx refuses outright. Rather
    than lose the metric on any case with an isolated entity, score the main
    component and leave the stragglers at zero, which is what their influence on
    the core network actually is.
    """
    if graph.number_of_nodes() == 0:
        return {}

    components = list(nx.connected_components(graph))
    target = graph if len(components) == 1 else graph.subgraph(max(components, key=len)).copy()

    scores = dict.fromkeys(graph.nodes, 0.0)
    try:
        scores.update(nx.eigenvector_centrality_numpy(target))
    except Exception:
        logger.warning("Eigenvector centrality unavailable for case %s", case_id)
    return scores


def _entity_labels(db: Session, case_id: int) -> dict[int, tuple[str, str]]:
    rows = db.scalars(select(models.Entity).where(models.Entity.case_id == case_id)).all()
    return {e.id: (e.canonical_name, e.entity_type) for e in rows}


def key_players(db: Session, case_id: int, *, metric: str, top: int) -> list[KeyPlayer]:
    """Top-N entities ranked by the requested centrality metric."""
    if metric not in METRIC_NAMES:
        raise ValueError(f"Unknown metric {metric!r}; expected one of {METRIC_NAMES}")

    scores = compute_metrics(db, case_id).get(metric, {})
    if not scores:
        return []

    labels = _entity_labels(db, case_id)
    ranked = sorted(scores.items(), key=lambda pair: pair[1], reverse=True)[:top]

    return [
        KeyPlayer(
            entity_id=entity_id,
            name=labels.get(entity_id, (str(entity_id), "PERSON"))[0],
            entity_type=labels.get(entity_id, (str(entity_id), "PERSON"))[1],
            metric=metric,
            score=round(float(score), 6),
            rank=position,
        )
        for position, (entity_id, score) in enumerate(ranked, start=1)
    ]


def community_index(db: Session, case_id: int) -> dict[int, int]:
    """entity_id -> community id, computed once and cached."""
    cached = _COMMUNITY_CACHE.get(case_id)
    if cached is not None:
        return cached

    graph = build_nx_graph(db, case_id, entity_types=ACTOR_ENTITY_TYPES)
    if graph.number_of_nodes() == 0:
        return {}

    partition = nx.community.louvain_communities(graph, seed=LOUVAIN_SEED)
    index = {
        node: community_id
        for community_id, members in enumerate(partition)
        for node in members
    }
    _COMMUNITY_CACHE[case_id] = index
    return index


def communities(db: Session, case_id: int) -> list[CommunityOut]:
    """Louvain community detection over the case graph."""
    index = community_index(db, case_id)
    if not index:
        return []

    labels = _entity_labels(db, case_id)
    degree = compute_metrics(db, case_id).get("degree", {})

    grouped: dict[int, list[int]] = {}
    for entity_id, community_id in index.items():
        grouped.setdefault(community_id, []).append(entity_id)

    result: list[CommunityOut] = []
    for community_id, members in sorted(grouped.items(), key=lambda kv: -len(kv[1])):
        types = [labels.get(m, ("", "PERSON"))[1] for m in members]
        dominant = max(set(types), key=types.count) if types else "PERSON"
        top_member = max(members, key=lambda m: degree.get(m, 0.0))
        result.append(
            CommunityOut(
                community_id=community_id,
                size=len(members),
                member_entity_ids=sorted(members),
                dominant_entity_type=dominant,
                top_member=labels.get(top_member, (str(top_member), ""))[0],
            )
        )
    return result


def shortest_path(db: Session, case_id: int, source: int, target: int) -> PathOut:
    """Shortest path between two entities, with the evidence behind each hop.

    Hop count, not edge weight: the investigative question is "how few steps
    separate these two people", and a heavily-weighted edge means a stronger
    link, not a longer one.
    """
    graph = build_nx_graph(db, case_id)
    if source not in graph or target not in graph:
        return PathOut(found=False)

    try:
        node_path = nx.shortest_path(graph, source=source, target=target)
    except nx.NetworkXNoPath:
        return PathOut(found=False)

    labels = _entity_labels(db, case_id)
    edges = [
        GraphEdge(
            id=f"{left}-{right}",
            source=str(left),
            target=str(right),
            rel_type=graph[left][right].get("rel_type", "ASSOCIATES_WITH"),
            weight=float(graph[left][right].get("weight", 1.0)),
            evidence=list(graph[left][right].get("evidence", [])),
        )
        for left, right in zip(node_path, node_path[1:], strict=False)
    ]

    return PathOut(
        found=True,
        entity_ids=list(node_path),
        names=[labels.get(n, (str(n), ""))[0] for n in node_path],
        edges=edges,
        hops=len(node_path) - 1,
    )


def vulnerabilities(db: Session, case_id: int, *, top: int) -> VulnerabilityReport:
    """Articulation points plus key-player removal simulation.

    This is the step that turns a centrality score into an operational
    recommendation. A high betweenness number says someone is a broker; the
    removal simulation says what actually happens to the network if that broker
    is taken out, which is the question an investigator is really asking.
    """
    graph = build_nx_graph(db, case_id, entity_types=ACTOR_ENTITY_TYPES)
    if graph.number_of_nodes() == 0:
        return VulnerabilityReport(articulation_point_entity_ids=[], removal_impacts=[])

    labels = _entity_labels(db, case_id)
    articulation = sorted(nx.articulation_points(graph))

    components_before = nx.number_connected_components(graph)
    largest_before = max((len(c) for c in nx.connected_components(graph)), default=0)

    betweenness = compute_metrics(db, case_id).get("betweenness", {})
    candidates = sorted(betweenness, key=lambda n: betweenness.get(n, 0.0), reverse=True)[:top]

    impacts: list[RemovalImpact] = []
    for entity_id in candidates:
        if entity_id not in graph:
            continue
        reduced = graph.copy()
        reduced.remove_node(entity_id)

        components_after = nx.number_connected_components(reduced)
        largest_after = max((len(c) for c in nx.connected_components(reduced)), default=0)

        impacts.append(
            RemovalImpact(
                entity_id=entity_id,
                name=labels.get(entity_id, (str(entity_id), ""))[0],
                components_before=components_before,
                components_after=components_after,
                largest_component_before=largest_before,
                largest_component_after=largest_after,
                fragmentation_delta=round(
                    1.0 - (largest_after / largest_before) if largest_before else 0.0, 4
                ),
            )
        )

    impacts.sort(key=lambda i: i.fragmentation_delta, reverse=True)
    return VulnerabilityReport(
        articulation_point_entity_ids=articulation, removal_impacts=impacts
    )
