"""Operation Broken Mirror, end to end: originals in, findings out.

The first milestone of MASTER_PLAN.md is here as a test: withdrawing the one
disputed origin removes everything that depended on it, keeps the connection
that had independent support, and gives exactly the result of starting over
from the permitted originals as preserved on disk.

Expectations are stated from the planted story (app/seed/broken_mirror.py),
not read back from the engine.
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import combinations

import pytest

from app.investigation import engine as E
from app.investigation import lineage
from app.investigation.extract import extract
from app.investigation.store import EvidenceStore
from app.seed.broken_mirror import build_case_files, default_cast, random_cast

TIP = "BM3_informant_tip_GD23.txt"
DIARY = "BM3_station_diary_GD31.txt"
BULLETIN = "BM3_district_bulletin.txt"


@dataclass
class Corpus:
    snapshot: E.Snapshot
    baseline: E.Projection
    names: dict[str, str]  # sha256 -> filename
    shas: dict[str, str]  # filename -> sha256
    files: dict


def build(cast) -> Corpus:
    files = build_case_files(cast)
    assertions: list[E.Assertion] = []
    infos: dict[tuple[str, str], lineage.ArtifactInfo] = {}
    names: dict[str, str] = {}
    for case, items in files.items():
        for item in items:
            out = extract(item.raw, case=case, kind=item.kind)
            assertions.extend(out.assertions)
            infos[(case, out.sha256)] = lineage.ArtifactInfo(
                out.sha256,
                case,
                item.filename,
                item.kind,
                out.reference,
                out.source_reference,
                out.document_date,
            )
            names[out.sha256] = item.filename
    assertions.sort(key=lambda a: a.key)
    snapshot = E.Snapshot(
        cases=tuple(sorted(files)),
        assertions=tuple(assertions),
        links=tuple(lineage.detect(assertions, infos)),
    )
    return Corpus(snapshot, E.derive(snapshot), names, {v: k for k, v in names.items()}, files)


@pytest.fixture(scope="module")
def corpus() -> Corpus:
    return build(default_cast())


def labelled(projection: E.Projection, finding: E.Finding) -> tuple[str, str]:
    return (projection.persons[finding.a].label, projection.persons[finding.b].label)


def by_names(projection: E.Projection) -> dict[tuple[str, str], E.Finding]:
    return {labelled(projection, f): f for f in projection.findings.values()}


def family_of(corpus: Corpus, filename: str) -> str:
    sha = corpus.shas[filename]
    keys = [a.key for a in corpus.snapshot.assertions if a.artifact == sha]
    return corpus.baseline.families[keys[0]]


# --- What the scenario plants -----------------------------------------------------------------


def test_every_accused_pair_is_found_with_the_planted_status(corpus):
    found = {pair: f.status for pair, f in by_names(corpus.baseline).items()}
    assert found == {
        ("Vikram Rane", "Deepak Mhatre"): E.SUPPORTED,
        ("Sameer Khan", "Deepak Mhatre"): E.SUPPORTED,
        ("Vikram Rane", "Pappu Shinde"): E.SUPPORTED,
        ("Deepak Mhatre", "Pappu Shinde"): E.SUPPORTED,
        # Rests on the tip alone, through an unreviewed name-only identity.
        ("Sameer Khan", "Pappu Shinde"): E.LEAD,
    }


def test_the_real_bridge_is_the_first_explanation(corpus):
    finding = by_names(corpus.baseline)[("Vikram Rane", "Pappu Shinde")]
    best = finding.explanations[0]
    chain = [corpus.baseline.persons[n].label for n in best.nodes]
    assert chain == ["Vikram Rane", "Rohit Vaze", "Deepak Mhatre", "Pappu Shinde"]
    assert best.status == E.SUPPORTED and not best.provisional and not best.hubs


def test_the_repeated_tip_is_one_origin_not_three(corpus):
    tip = family_of(corpus, TIP)
    assert family_of(corpus, DIARY) == tip
    assert family_of(corpus, BULLETIN) == tip

    bases = {
        corpus.names[corpus.snapshot.assertion_map()[link.derivative].artifact]: (
            link.basis,
            link.status,
        )
        for link in corpus.snapshot.links
        if corpus.names[corpus.snapshot.assertion_map()[link.origin].artifact] == TIP
    }
    assert bases == {
        BULLETIN: ("declared_reference", "confirmed"),
        DIARY: ("near_verbatim", "proposed"),
    }


def test_reassigned_number_is_never_pinned_on_its_old_owner_by_record(corpus):
    """May's calls on 9867012345 reach Sameer only through the tip's claim."""
    by_key = corpus.snapshot.assertion_map()
    for edge in corpus.baseline.edges.values():
        if edge.type != E.CALLED or "khan sameer" not in edge.source + edge.target:
            continue
        for derivation in edge.derivations:
            event = next(by_key[k] for k in derivation if by_key[k].predicate == E.CONTACT)
            if event.start.month == 5:
                holdings = [by_key[k] for k in derivation if by_key[k].predicate == E.HOLDS]
                sameer = [h for h in holdings if "khan sameer" in h.subject]
                assert all(h.kind == E.CLAIM for h in sameer)
                assert all(corpus.names[h.artifact] in {TIP, DIARY, BULLETIN} for h in sameer)


def test_the_claim_is_contested_by_the_subscriber_record(corpus):
    conflicts = {
        (c.identifier, frozenset(corpus.baseline.persons[p].label for p, _ in c.holders))
        for c in corpus.baseline.conflicts
    }
    assert ("PHONE:9867012345", frozenset({"Sameer Khan", "Anil Borade"})) in conflicts


def test_same_name_different_people_are_proposed_never_merged(corpus):
    kiran = [
        c
        for c in corpus.baseline.candidates.values()
        if {corpus.baseline.persons[c.a].label, corpus.baseline.persons[c.b].label}
        == {"Kiran Salvi"}
    ]
    (candidate,) = kiran
    assert candidate.name_match and not candidate.shared
    assert candidate.status == "proposed" and candidate.provisional


def test_the_taxi_driver_is_a_high_activity_contact(corpus):
    hubs = {corpus.baseline.persons[h].label for h in corpus.baseline.hubs}
    assert hubs == {"Ramesh Gupta"}
    for finding in corpus.baseline.findings.values():
        for explanation in finding.explanations:
            if explanation.hubs:
                assert explanation.status == E.LEAD


def test_a_naive_graph_reports_the_false_bridge_as_supported(corpus):
    naive = E.derive(corpus.snapshot, E.Scenario.build(naive=True))
    pairs = {labelled(naive, f): f for f in naive.findings.values()}
    false_bridge = pairs[("Sameer Khan", "Pappu Shinde")]
    assert false_bridge.status == E.SUPPORTED
    assert false_bridge.distance == 1


# --- The milestone ----------------------------------------------------------------------------


def test_withdrawing_the_disputed_origin_equals_starting_over_from_permitted_originals(
    corpus, tmp_path
):
    store = EvidenceStore(tmp_path)
    for items in corpus.files.values():
        for item in items:
            store.put(item.raw)

    baseline = corpus.baseline
    tip = family_of(corpus, TIP)
    members = {key for key, family in baseline.families.items() if family == tip}
    doomed = {corpus.snapshot.assertion_map()[k].artifact for k in members}
    # Here the family is three whole documents: every statement they make repeats the tip.
    assert {corpus.names[s] for s in doomed} == {TIP, DIARY, BULLETIN}
    assert members == {a.key for a in corpus.snapshot.assertions if a.artifact in doomed}

    subjects = sorted(baseline.anchors)
    fast = E.restrict(baseline, members)
    scenario = E.derive(
        corpus.snapshot, E.Scenario.build(exclude_families={tip}), subjects=subjects
    )

    # Start over: re-read every permitted original from the store and recompute.
    assertions: list[E.Assertion] = []
    infos = {}
    for case, items in corpus.files.items():
        for item in items:
            sha = corpus.shas[item.filename]
            if sha in doomed:
                continue
            out = extract(store.get(sha), case=case, kind=item.kind, sha256=sha)
            assertions.extend(out.assertions)
            infos[(case, sha)] = lineage.ArtifactInfo(
                sha,
                case,
                item.filename,
                item.kind,
                out.reference,
                out.source_reference,
                out.document_date,
            )
    assertions.sort(key=lambda a: a.key)
    clean = E.derive(
        E.Snapshot(
            cases=corpus.snapshot.cases,
            assertions=tuple(assertions),
            links=tuple(lineage.detect(assertions, infos)),
        ),
        subjects=subjects,
    )

    assert fast == dict(scenario.edges) == dict(clean.edges)
    assert set(scenario.persons) == set(clean.persons)
    for key, finding in baseline.findings.items():
        statuses = {
            E.finding_status(fast, finding, E.DEFAULT_MAX_HOPS, baseline.anchors),
            scenario.findings[key].status if key in scenario.findings else E.UNSUPPORTED,
            clean.findings[key].status if key in clean.findings else E.UNSUPPORTED,
        }
        assert len(statuses) == 1, (labelled(baseline, finding), statuses)

    # All dependent support is gone: the false bridge, the tip's Sameer, his
    # identity link, and every call attributed through the claim.
    after = by_names(clean)
    assert ("Sameer Khan", "Pappu Shinde") not in after
    assert "P:BM-3:khan sameer" not in clean.persons
    assert not [e for e in clean.edges.values() if "P:BM-3:khan sameer" in (e.source, e.target)]

    # The connection that had independent support is still there, unchanged.
    kept = after[("Vikram Rane", "Pappu Shinde")]
    assert kept.status == E.SUPPORTED
    assert [clean.persons[n].label for n in kept.explanations[0].nodes] == [
        "Vikram Rane",
        "Rohit Vaze",
        "Deepak Mhatre",
        "Pappu Shinde",
    ]


def test_every_single_and_paired_withdrawal_agrees_with_recomputation(corpus):
    """The fast path the sensitivity search uses, held to the reference."""
    baseline = corpus.baseline
    subjects = sorted(baseline.anchors)
    families = sorted(set(baseline.families.values()))
    members: dict[str, set[str]] = {}
    for key, family in baseline.families.items():
        members.setdefault(family, set()).add(key)

    for size in (1, 2):
        for withdrawn in combinations(families, size):
            excluded = set().union(*(members[f] for f in withdrawn))
            fast = E.restrict(baseline, excluded)
            clean = E.derive(
                corpus.snapshot, E.Scenario.build(exclude_families=withdrawn), subjects=subjects
            )
            assert fast == dict(clean.edges), withdrawn
            for key, finding in baseline.findings.items():
                expected = clean.findings[key].status if key in clean.findings else E.UNSUPPORTED
                got = E.finding_status(fast, finding, E.DEFAULT_MAX_HOPS, baseline.anchors)
                assert got == expected, (withdrawn, key)


def test_disputing_the_origin_retires_its_copies_too(corpus):
    by_key = corpus.snapshot.assertion_map()
    passage = [a.key for a in corpus.snapshot.assertions if corpus.names[a.artifact] == TIP]
    disputed = E.derive(
        corpus.snapshot,
        E.Scenario.build(assertions={k: "disputed" for k in passage}),
        subjects=sorted(corpus.baseline.anchors),
    )
    copies = [
        a.key for a in corpus.snapshot.assertions if corpus.names[a.artifact] in {DIARY, BULLETIN}
    ]
    assert copies and not set(copies) & disputed.active
    assert ("Sameer Khan", "Pappu Shinde") not in by_names(disputed)
    assert by_key  # keys resolved against the same snapshot


# --- Not overfit to one set of strings --------------------------------------------------------


@pytest.mark.parametrize("seed", [11, 23, 37])
def test_the_story_holds_with_other_names_and_numbers(seed):
    cast = random_cast(seed)
    corpus = build(cast)
    found = {pair: f.status for pair, f in by_names(corpus.baseline).items()}
    assert found.get((cast.sameer, cast.pappu)) == E.LEAD
    assert found.get((cast.vikram, cast.deepak)) == E.SUPPORTED
    assert found.get((cast.deepak, cast.pappu)) == E.SUPPORTED

    tip = family_of(corpus, TIP)
    without = E.derive(
        corpus.snapshot,
        E.Scenario.build(exclude_families={tip}),
        subjects=sorted(corpus.baseline.anchors),
    )
    after = by_names(without)
    assert (cast.sameer, cast.pappu) not in after
    assert after[(cast.vikram, cast.pappu)].status == E.SUPPORTED
