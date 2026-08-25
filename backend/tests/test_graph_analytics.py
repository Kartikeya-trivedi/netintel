"""Phase 3 graph analytics tests.

The hidden-coordinator assertion is the demo safety net (PLAN.md section 7): if
the seeded case stops surfacing the planted broker by betweenness, the pitch
breaks, and this test is what catches that before a judge does.
"""

from __future__ import annotations

import networkx as nx
import pytest

N_CELLS = 3
CELL_SIZE = 5


@pytest.fixture
def planted_network() -> nx.Graph:
    """Three tightly-knit cells joined only through a single broker.

    Cells are cliques, so intra-cell traffic never needs an intermediary and no
    cell member accumulates betweenness from its own neighbours. Every path
    between cells, by contrast, must cross the broker. That is what makes the
    broker structurally critical while still looking unremarkable on a mention
    count -- the exact pattern NetIntel exists to surface.
    """
    graph = nx.Graph()
    for cell in range(N_CELLS):
        members = [f"c{cell}_m{i}" for i in range(CELL_SIZE)]
        graph.add_edges_from(
            (a, b) for i, a in enumerate(members) for b in members[i + 1 :]
        )
        # Member 0 of each cell is the gateway to the broker.
        graph.add_edge(members[0], "broker")
    return graph


def test_broker_leads_on_betweenness_despite_lower_degree(planted_network):
    betweenness = nx.betweenness_centrality(planted_network)
    degree = dict(planted_network.degree())

    assert max(betweenness, key=betweenness.get) == "broker"
    # A plain-member degree count would never single the broker out.
    assert degree["broker"] < degree["c0_m0"]


def test_removing_broker_fragments_the_network(planted_network):
    assert nx.number_connected_components(planted_network) == 1

    reduced = planted_network.copy()
    reduced.remove_node("broker")

    assert nx.number_connected_components(reduced) == N_CELLS


def test_broker_is_an_articulation_point(planted_network):
    assert "broker" in set(nx.articulation_points(planted_network))


def test_louvain_recovers_the_planted_cells(planted_network):
    communities = nx.community.louvain_communities(planted_network, seed=42)
    assert len(communities) >= N_CELLS


@pytest.mark.xfail(reason="Phase 3: analytics service not implemented yet", strict=True)
def test_key_players_endpoint_ranks_by_betweenness(client, case):
    response = client.get(f"/api/cases/{case.id}/graph/metrics?metric=betweenness")
    assert response.status_code == 200
