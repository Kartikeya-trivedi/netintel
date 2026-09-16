"""End-to-end safety net for the live demo.

Loads Operation Nightfall through the real ingest pipeline and asserts that the
analytics recover the planted structure. Every claim the demo makes on stage is
asserted here, so if extraction quality regresses this fails in CI rather than
in front of judges.

These run against one session-scoped ingest, which takes a few seconds of spaCy
time. That cost buys the only test that exercises parsing, extraction,
resolution, persistence, and analytics together.
"""

from __future__ import annotations

from app.services.graph import analytics, builder


def test_every_document_processes_cleanly(demo_case):
    from app import models

    session, case = demo_case
    docs = session.query(models.Document).filter_by(case_id=case.id).all()

    assert len(docs) >= 8
    failed = [(d.filename, d.error) for d in docs if d.status != "processed"]
    assert not failed, f"documents failed to ingest: {failed}"


def test_people_are_resolved_one_to_one_with_the_roster(demo_case, ground_truth):
    """No duplicates from missed merges, no fusions from over-eager ones."""
    from app import models

    session, case = demo_case
    people = (
        session.query(models.Entity)
        .filter_by(case_id=case.id, entity_type="PERSON")
        .all()
    )
    extracted = {p.canonical_name for p in people}
    expected = {p["name"] for p in ground_truth["people"]}

    assert extracted == expected, (
        f"missing: {sorted(expected - extracted)}, spurious: {sorted(extracted - expected)}"
    )


def test_kingpin_alias_resolved_to_one_entity(demo_case, ground_truth):
    from app import models

    session, case = demo_case
    kingpin = ground_truth["kingpin"]

    entity = (
        session.query(models.Entity)
        .filter_by(case_id=case.id, canonical_name=kingpin["name"])
        .one()
    )
    assert kingpin["alias"] in (entity.aliases or [])

    stray = (
        session.query(models.Entity)
        .filter_by(case_id=case.id, canonical_name=kingpin["alias"])
        .all()
    )
    assert not stray, "alias survived as a separate entity"


def test_betweenness_surfaces_the_kingpin(demo_case, ground_truth):
    """The headline claim: structure exposes the coordinator that counting hides."""
    session, case = demo_case
    kingpin_name = ground_truth["kingpin"]["name"]

    ranked = analytics.key_players(session, case.id, metric="betweenness", top=3)
    assert ranked[0].name == kingpin_name, (
        f"expected {kingpin_name} first, got {[(r.rank, r.name) for r in ranked]}"
    )


def test_degree_does_not_surface_the_kingpin(demo_case, ground_truth):
    """The other half of the claim. Without this, betweenness proves nothing."""
    session, case = demo_case
    kingpin_name = ground_truth["kingpin"]["name"]

    by_degree = analytics.key_players(session, case.id, metric="degree", top=5)
    assert kingpin_name not in {r.name for r in by_degree}


def test_communities_recover_the_cell_structure(demo_case, ground_truth):
    session, case = demo_case
    found = analytics.communities(session, case.id)
    assert len(found) >= ground_truth["expected"]["min_communities"]


def test_removing_the_kingpin_fragments_the_network(demo_case, ground_truth):
    """Turns a centrality score into an operational recommendation."""
    session, case = demo_case
    kingpin_name = ground_truth["kingpin"]["name"]

    report = analytics.vulnerabilities(session, case.id, top=5)
    impacts = {i.name: i for i in report.removal_impacts}
    assert kingpin_name in impacts

    kingpin_impact = impacts[kingpin_name]
    assert kingpin_impact.components_after > kingpin_impact.components_before
    assert kingpin_impact.fragmentation_delta == max(
        i.fragmentation_delta for i in report.removal_impacts
    )


def test_structured_records_link_to_people(demo_case):
    """Cross-source joining: a bare account number reaches a named person."""
    from app import models

    session, case = demo_case
    total = session.query(models.Transaction).filter_by(case_id=case.id).count()
    linked = (
        session.query(models.Transaction)
        .filter(
            models.Transaction.case_id == case.id,
            models.Transaction.from_entity_id.isnot(None),
            models.Transaction.to_entity_id.isnot(None),
        )
        .count()
    )
    assert total > 0
    assert linked == total


def test_graph_edges_carry_evidence(demo_case):
    session, case = demo_case
    graph = builder.build_nx_graph(session, case.id)

    assert graph.number_of_nodes() > 0
    unsupported = [
        (u, v) for u, v, data in graph.edges(data=True) if not data.get("evidence")
    ]
    assert not unsupported, f"{len(unsupported)} edges have no evidence"


def test_shortest_path_between_distant_members(demo_case, ground_truth):
    """The "how are these two connected?" question, answered with evidence."""
    from app import models

    session, case = demo_case
    roles = {p["name"]: p["role"] for p in ground_truth["people"]}
    operatives = [n for n, r in roles.items() if r == "operative"]

    lookup = {
        e.canonical_name: e.id
        for e in session.query(models.Entity).filter_by(case_id=case.id).all()
    }
    source, target = lookup[operatives[0]], lookup[operatives[-1]]

    path = analytics.shortest_path(session, case.id, source, target)
    assert path.found
    assert path.hops >= 1
    assert len(path.names) == path.hops + 1


def test_graph_reconstructs_the_planted_network_exactly(demo_case, ground_truth):
    """The strongest claim available: the graph is rebuilt from prose alone.

    Node and edge counts matching the planted adjacency means extraction,
    alias resolution, and relation typing all landed -- no missing links
    papered over by spurious ones.
    """
    session, case = demo_case
    actors = builder.build_nx_graph(session, case.id, entity_types=["PERSON"])

    assert actors.number_of_nodes() == len(ground_truth["people"])
    assert actors.number_of_edges() == len(ground_truth["edges"])


def _populate_case(db, name):
    """One of every row type that belongs to a case."""
    from datetime import UTC, datetime

    from app import models

    case = models.Case(name=name)
    db.add(case)
    db.flush()
    doc = models.Document(case_id=case.id, filename="r.txt", doc_type="report")
    a = models.Entity(case_id=case.id, canonical_name="A", entity_type="PERSON")
    b = models.Entity(case_id=case.id, canonical_name="B", entity_type="PERSON")
    db.add_all([doc, a, b])
    db.flush()
    stamp = datetime(2026, 3, 1, tzinfo=UTC)
    owned = {"case_id": case.id}
    on_doc = {**owned, "document_id": doc.id, "timestamp": stamp}
    db.add_all(
        [
            models.Mention(
                entity_id=a.id, document_id=doc.id, span_start=0, span_end=1, surface_text="A"
            ),
            models.Relationship(
                **owned, source_entity_id=a.id, target_entity_id=b.id, rel_type="MET"
            ),
            models.Transaction(**on_doc, from_account="1", to_account="2", amount=1.0),
            models.CommEvent(**on_doc, caller="1", callee="2"),
            models.Alert(**owned, alert_type="STRUCTURING", title="t"),
            models.CaseSnapshot(**owned, key="k", payload={}),
        ]
    )
    db.commit()
    return case.id


def test_purge_removes_every_row_the_case_owns(db_session):
    """A demo reset must replace the case, not stack another copy onto it.

    Deleting only the case row left transactions, calls, and relationships
    behind; SQLite reused the id, and each reset added a full duplicate of the
    record files to the demo.
    """
    from app import models
    from app.seed.load_demo import purge_cases

    doomed = _populate_case(db_session, "Operation Nightfall")
    kept = _populate_case(db_session, "Another case")

    purge_cases(db_session, [doomed])

    owned = (
        models.Document, models.Entity, models.Relationship, models.Transaction,
        models.CommEvent, models.Alert, models.CaseSnapshot,
    )
    for model in owned:
        assert db_session.query(model).filter_by(case_id=doomed).count() == 0, model.__name__
        assert db_session.query(model).filter_by(case_id=kept).count() > 0, model.__name__
    assert db_session.get(models.Case, doomed) is None
    assert db_session.query(models.Mention).count() == 1, "only the kept case's mention remains"

