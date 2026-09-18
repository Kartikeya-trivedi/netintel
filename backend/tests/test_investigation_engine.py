"""The reasoning engine's semantics, on corpora small enough to read.

Every expectation here is stated from first principles rather than from the
engine's own output: which call rows need which subscriber records, when a
reassigned number stops pointing at its old owner, what a withdrawal must take
with it and what it must leave alone.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from itertools import combinations

import pytest

from app.investigation import engine as E
from app.investigation.normalize import person_key

IST = timezone(timedelta(hours=5, minutes=30))


def day(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=IST)


def moment(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=IST)


class Corpus:
    """Builds assertions with readable defaults; one artifact per source name."""

    def __init__(self) -> None:
        self.assertions: list[E.Assertion] = []
        self.links: list[E.LineageLink] = []

    def _add(self, artifact: str, case: str, predicate: str, subject: str, **kw) -> E.Assertion:
        key = f"a{len(self.assertions) + 1:03d}"
        item = kw.pop("item", f"row:{len(self.assertions) + 1}")
        assertion = E.Assertion(
            key=key,
            case=case,
            artifact=f"{artifact:<16}".replace(" ", "_"),
            item=item,
            predicate=predicate,
            subject=subject,
            **kw,
        )
        self.assertions.append(assertion)
        return assertion

    def holds(self, artifact, case, name, identifier, start=None, end=None, kind=E.RECORD):
        return self._add(
            artifact,
            case,
            E.HOLDS,
            person_key(case, name),
            object=identifier,
            start=start,
            end=end,
            kind=kind,
            subject_label=name,
        )

    def call(self, artifact, case, caller, callee, when):
        return self._add(artifact, case, E.CONTACT, caller, object=callee, start=when)

    def transfer(self, artifact, case, payer, payee, when, amount=10_000.0):
        return self._add(artifact, case, E.TRANSFER, payer, object=payee, start=when, amount=amount)

    def link(self, artifact, case, a, b, polarity=1, when=None):
        return self._add(
            artifact,
            case,
            E.LINK,
            person_key(case, a),
            object=person_key(case, b),
            start=when,
            polarity=polarity,
            kind=E.CLAIM,
            subject_label=a,
            object_label=b,
        )

    def accused(self, artifact, case, name):
        return self._add(
            artifact, case, E.ACCUSED, person_key(case, name), kind=E.CLAIM, subject_label=name
        )

    def copy(self, derivative, origin, status="proposed"):
        link = E.LineageLink(
            key=f"ll-{derivative.key}-{origin.key}",
            derivative=derivative.key,
            origin=origin.key,
            basis="near_verbatim",
            status=status,
        )
        self.links.append(link)
        return link

    def snapshot(self, cases=("A", "B", "C"), **kw) -> E.Snapshot:
        return E.Snapshot(
            cases=tuple(cases),
            assertions=tuple(self.assertions),
            links=tuple(self.links),
            **kw,
        )


def P(case: str, name: str) -> str:
    return person_key(case, name)


def bridge_corpus() -> Corpus:
    """Two cases joined through Rohit Vaze by money and, separately, by calls."""
    c = Corpus()
    c.accused("fir-a", "A", "Vikram Rane")
    c.accused("fir-b", "B", "Deepak Mhatre")
    c.holds("kyc-a", "A", "Vikram Rane", "ACCOUNT:3", day("2025-01-01"))
    c.holds("kyc-a", "A", "Rohit Vaze", "ACCOUNT:2", day("2025-01-01"))
    c.holds("kyc-a", "A", "Rohit Vaze", "PHONE:9820012345", day("2025-06-01"))
    c.holds("kyc-b", "B", "Deepak Mhatre", "ACCOUNT:4", day("2025-01-01"))
    c.holds("kyc-b", "B", "Deepak Mhatre", "PHONE:9000000002", day("2025-01-01"))
    c.transfer("stmt-a", "A", "ACCOUNT:2", "ACCOUNT:3", moment("2026-03-01T10:00"))
    c.transfer("stmt-b", "B", "ACCOUNT:2", "ACCOUNT:4", moment("2026-04-11T10:00"))
    c.call("cdr-b", "B", "PHONE:9820012345", "PHONE:9000000002", moment("2026-04-10T21:00"))
    return c


# --- Attribution -----------------------------------------------------------------


def test_call_needs_the_row_and_both_holdings():
    projection = E.derive(bridge_corpus().snapshot())
    edge = projection.edges[E.edge_key(E.CALLED, P("A", "Rohit Vaze"), P("B", "Deepak Mhatre"))]

    (derivation,) = edge.derivations
    by_key = {a.key: a for a in bridge_corpus().assertions}
    kinds = sorted(by_key[k].predicate for k in derivation)
    assert kinds == [E.CONTACT, E.HOLDS, E.HOLDS]


def test_reassigned_number_follows_the_record_covering_the_moment():
    c = Corpus()
    c.holds("kyc-a", "A", "Sameer Khan", "PHONE:9867012345", day("2024-11-02"), day("2026-04-01"))
    c.holds("kyc-c", "C", "Anil Borade", "PHONE:9867012345", day("2026-04-20"))
    c.holds("kyc-c", "C", "Pappu Shinde", "PHONE:9000000003", day("2025-01-01"))
    c.call("cdr-a", "A", "PHONE:9867012345", "PHONE:9000000003", moment("2026-02-10T10:00"))
    c.call("cdr-c", "C", "PHONE:9867012345", "PHONE:9000000003", moment("2026-05-12T10:00"))

    edges = E.derive(c.snapshot()).edges
    sameer = E.edge_key(E.CALLED, P("A", "Sameer Khan"), P("C", "Pappu Shinde"))
    anil = E.edge_key(E.CALLED, P("C", "Anil Borade"), P("C", "Pappu Shinde"))

    # February belongs to Sameer's registration, May to Anil's. Neither call
    # is pinned on both of them.
    assert len(edges[sameer].derivations) == 1
    assert len(edges[anil].derivations) == 1
    (feb,) = edges[sameer].derivations
    (may,) = edges[anil].derivations
    assert "a004" in feb and "a005" in may


def test_gap_between_registrations_attributes_to_nobody():
    c = Corpus()
    c.holds("kyc-a", "A", "Sameer Khan", "PHONE:9867012345", day("2024-11-02"), day("2026-04-01"))
    c.holds("kyc-c", "C", "Anil Borade", "PHONE:9867012345", day("2026-04-20"))
    c.holds("kyc-c", "C", "Pappu Shinde", "PHONE:9000000003", day("2025-01-01"))
    c.call("cdr-c", "C", "PHONE:9867012345", "PHONE:9000000003", moment("2026-04-10T10:00"))

    assert not [e for e in E.derive(c.snapshot()).edges.values() if e.type == E.CALLED]


def test_claim_window_is_an_assumption_of_the_scenario():
    c = Corpus()
    c.holds("tip", "C", "Sameer Khan", "PHONE:9867012345", day("2026-05-12"), kind=E.CLAIM)
    c.holds("kyc-c", "C", "Pappu Shinde", "PHONE:9000000003", day("2025-01-01"))
    c.call("cdr-c", "C", "PHONE:9867012345", "PHONE:9000000003", moment("2026-05-15T10:00"))
    key = E.edge_key(E.CALLED, P("C", "Sameer Khan"), P("C", "Pappu Shinde"))

    assert key in E.derive(c.snapshot(), E.Scenario.build(claim_window_days=7)).edges
    assert key not in E.derive(c.snapshot(), E.Scenario.build(claim_window_days=1)).edges


def test_two_holders_at_one_moment_is_a_conflict_not_a_merge():
    c = Corpus()
    c.holds("tip", "C", "Sameer Khan", "PHONE:9867012345", day("2026-05-12"), kind=E.CLAIM)
    c.holds("kyc-c", "C", "Anil Borade", "PHONE:9867012345", day("2026-04-20"))
    c.holds("kyc-c", "C", "Pappu Shinde", "PHONE:9000000003", day("2025-01-01"))
    c.call("cdr-c", "C", "PHONE:9867012345", "PHONE:9000000003", moment("2026-05-12T10:00"))

    projection = E.derive(c.snapshot())
    (conflict,) = projection.conflicts
    assert conflict.identifier == "PHONE:9867012345"
    assert {person for person, _ in conflict.holders} == {
        P("C", "Sameer Khan"),
        P("C", "Anil Borade"),
    }
    # Both readings stay available as separate relationships.
    called = {(e.source, e.target) for e in projection.edges.values() if e.type == E.CALLED}
    assert (P("C", "Sameer Khan"), P("C", "Pappu Shinde")) in called
    assert (P("C", "Anil Borade"), P("C", "Pappu Shinde")) in called


# --- Findings --------------------------------------------------------------------


def test_bridge_finding_is_supported_by_records():
    projection = E.derive(bridge_corpus().snapshot())
    (finding,) = projection.findings.values()

    assert (finding.a, finding.b) == (P("A", "Vikram Rane"), P("B", "Deepak Mhatre"))
    assert finding.status == E.SUPPORTED
    assert finding.distance == 2
    assert finding.explanations[0].nodes == (
        P("A", "Vikram Rane"),
        P("A", "Rohit Vaze"),
        P("B", "Deepak Mhatre"),
    )


def test_independent_derivation_survives_withdrawal_of_the_other():
    projection = E.derive(bridge_corpus().snapshot())
    (finding,) = projection.findings.values()
    cdr = E.family_key(
        next(a.artifact for a in bridge_corpus().assertions if a.predicate == E.CONTACT)
    )

    without_calls = E.derive(bridge_corpus().snapshot(), E.Scenario.build(exclude_families={cdr}))
    assert without_calls.findings[finding.key].status == E.SUPPORTED
    assert not [e for e in without_calls.edges.values() if e.type == E.CALLED]


def test_shared_dependency_is_what_breaks_the_finding():
    projection = E.derive(bridge_corpus().snapshot())
    (finding,) = projection.findings.values()
    kyc_a = E.family_key("kyc-a" + "_" * 11)

    broken = E.derive(bridge_corpus().snapshot(), E.Scenario.build(exclude_families={kyc_a}))
    assert finding.key not in broken.findings


def lead_corpus() -> Corpus:
    """A same-named person in two cases, connected only through the name."""
    c = Corpus()
    c.accused("fir-a", "A", "Vikram Rane")
    c.accused("fir-c", "C", "Pappu Shinde")
    c.link("fir-a", "A", "Vikram Rane", "Sameer Khan")
    c.link("tip", "C", "Sameer Khan", "Pappu Shinde")
    return c


def test_name_only_identity_is_a_lead_never_a_merge():
    projection = E.derive(lead_corpus().snapshot())
    (finding,) = projection.findings.values()

    assert finding.status == E.LEAD
    (candidate,) = projection.candidates.values()
    assert candidate.name_match and candidate.provisional and candidate.status == "proposed"
    assert finding.explanations[0].provisional == (candidate.key,)


def test_rejecting_the_identity_removes_the_lead():
    projection = E.derive(lead_corpus().snapshot())
    (candidate,) = projection.candidates.values()

    rejected = E.derive(
        lead_corpus().snapshot(), E.Scenario.build(identity={candidate.key: "rejected"})
    )
    assert rejected.findings == {}


def test_leads_can_be_switched_off_entirely():
    projection = E.derive(lead_corpus().snapshot(), E.Scenario.build(provisional_identities=False))
    assert projection.findings == {}


def test_accepted_identity_stands_only_on_its_cited_evidence():
    corpus = lead_corpus()
    snapshot = corpus.snapshot()
    (candidate,) = E.derive(snapshot).candidates.values()
    cited = corpus.assertions[3].key  # the tip's claim
    decided = corpus.snapshot(
        decisions=(
            E.IdentityDecision(candidate.key, candidate.a, candidate.b, "accepted", (cited,)),
        )
    )

    assert next(iter(E.derive(decided).findings.values())).status == E.SUPPORTED

    tip = E.family_key(corpus.assertions[3].artifact)
    without_tip = E.derive(decided, E.Scenario.build(exclude_families={tip}))
    assert not without_tip.findings
    assert not [e for e in without_tip.edges.values() if e.type == E.SAME_AS]


def test_denial_is_contrary_evidence_not_support():
    c = Corpus()
    c.link("statement", "A", "Vikram Rane", "Sameer Khan", polarity=-1)
    projection = E.derive(c.snapshot())
    assert not projection.edges
    assert projection.denials == ((P("A", "Sameer Khan"), P("A", "Vikram Rane"), "a001"),)


# --- Lineage -----------------------------------------------------------------------


def test_copies_join_their_origin_family_and_withdraw_with_it():
    c = lead_corpus()
    origin = c.assertions[3]
    diary = c.link("diary", "C", "Sameer Khan", "Pappu Shinde")
    bulletin = c.link("bulletin", "C", "Sameer Khan", "Pappu Shinde")
    c.copy(diary, origin)
    c.copy(bulletin, origin, status="confirmed")

    families = E.assign_families(c.snapshot())
    assert families[diary.key] == families[bulletin.key] == families[origin.key]

    without = E.derive(c.snapshot(), E.Scenario.build(exclude_families={families[origin.key]}))
    assert not without.findings


def test_rejecting_a_grouping_makes_the_copy_its_own_origin():
    c = lead_corpus()
    origin = c.assertions[3]
    diary = c.link("diary", "C", "Sameer Khan", "Pappu Shinde")
    link = c.copy(diary, origin)

    scenario = E.Scenario.build(groupings={link.key: "rejected"})
    families = E.assign_families(c.snapshot(), scenario)
    assert families[diary.key] != families[origin.key]

    only_origin_out = E.Scenario.build(
        groupings={link.key: "rejected"}, exclude_families={families[origin.key]}
    )
    assert E.derive(c.snapshot(), only_origin_out).findings


# --- The oracle ----------------------------------------------------------------------


def oracle_corpus() -> Corpus:
    c = bridge_corpus()
    origin = c.link("tip", "B", "Deepak Mhatre", "Rohit Vaze")
    copy = c.link("diary", "B", "Deepak Mhatre", "Rohit Vaze")
    c.copy(copy, origin)
    c.holds("kyc-b2", "B", "Rohit Vaze", "PHONE:9820012345", day("2025-06-01"))
    c.link("fir-a", "A", "Vikram Rane", "Rohit Vaze")
    return c


@pytest.mark.parametrize("size", [1, 2])
def test_restrict_agrees_with_recomputation_for_every_withdrawal(size):
    """The fast path must equal a clean derive with the families excluded."""
    snapshot = oracle_corpus().snapshot()
    baseline = E.derive(snapshot)
    subjects = sorted(baseline.anchors)
    families = sorted(set(baseline.families.values()))

    for withdrawn in combinations(families, size):
        excluded = {k for k, f in baseline.families.items() if f in withdrawn}
        fast = E.restrict(baseline, excluded)
        clean = E.derive(snapshot, E.Scenario.build(exclude_families=withdrawn), subjects=subjects)
        assert fast == dict(clean.edges), withdrawn
        for key, finding in baseline.findings.items():
            expected = clean.findings[key].status if key in clean.findings else E.UNSUPPORTED
            status = E.finding_status(fast, finding, E.DEFAULT_MAX_HOPS, baseline.anchors)
            assert status == expected, withdrawn


def test_derive_is_deterministic():
    snapshot = oracle_corpus().snapshot()
    assert E.derive(snapshot) == E.derive(snapshot)


# --- The contrast ------------------------------------------------------------------------


def test_naive_view_merges_names_and_ignores_time():
    c = Corpus()
    c.accused("fir-a", "A", "Vikram Rane")
    c.accused("fir-c", "C", "Pappu Shinde")
    c.link("fir-a", "A", "Vikram Rane", "Sameer Khan")
    c.holds("kyc-a", "A", "Sameer Khan", "PHONE:9867012345", day("2024-11-02"), day("2026-04-01"))
    c.holds("kyc-c", "C", "Anil Borade", "PHONE:9867012345", day("2026-04-20"))
    c.holds("kyc-c", "C", "Pappu Shinde", "PHONE:9000000003", day("2025-01-01"))
    c.call("cdr-c", "C", "PHONE:9867012345", "PHONE:9000000003", moment("2026-05-12T10:00"))

    careful = E.derive(c.snapshot())
    naive = E.derive(c.snapshot(), E.Scenario.build(naive=True))

    assert not careful.findings
    (finding,) = naive.findings.values()
    assert finding.status == E.SUPPORTED
    assert "P:ALL:khan sameer" in finding.explanations[0].nodes


def test_high_activity_contact_is_labelled():
    c = Corpus()
    c.holds("kyc", "A", "Ramesh Gupta", "PHONE:9000000099", day("2025-01-01"))
    for index in range(E.HUB_MIN_COUNTERPARTS):
        number = f"PHONE:90000001{index:02d}"
        c.holds("kyc", "A", f"Caller Number{index}", number, day("2025-01-01"))
        c.call("cdr", "A", number, "PHONE:9000000099", moment("2026-03-01T10:00"))
    assert P("A", "Ramesh Gupta") in E.derive(c.snapshot(cases=("A",))).hubs
