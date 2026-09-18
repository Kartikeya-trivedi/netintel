"""The reasoning core: assertions in, findings out, every dependency kept.

Consumed by investigation.sensitivity, investigation.verification,
investigation.service and investigation.package.

Pure and deterministic: no database, no clock, no randomness. The same snapshot
and scenario always yield the same projection, which is what lets a scenario be
compared with its baseline, a withdrawal be checked against a clean
recomputation, and an exported finding be reproduced by someone else.

How a relationship is supported
-------------------------------
Every derived edge carries its derivations: sets of atoms (assertion keys, plus
``id:<candidate>`` for an identity assumption) that must ALL hold for that
derivation to hold. An edge holds while ANY derivation does. A person-to-person
call is therefore

    call_row  AND  caller_holds_number_at_t  AND  callee_holds_number_at_t

and a second call row, or a second subscriber record covering the same moment,
is a second derivation rather than extra weight. Withdrawing a source removes
exactly the derivations that mention it; an edge with an independent derivation
left survives, and one without disappears. Nothing is hidden and left cached.

Identity is never decided here
------------------------------
People are case-local references. Cross-case identity arrives only as a
candidate (a name match, or an identifier both held at overlapping times) or as
an investigator's decision. An unreviewed candidate may carry a connection, but
only as a *provisional* link, and every finding that depends on one says so.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter, defaultdict, deque
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
from heapq import heappop, heappush
from itertools import combinations, pairwise

from app.investigation.normalize import case_of, is_person, name_of
from app.services.extraction.resolver import names_match

ENGINE_VERSION = "netintel-engine/1"

# --- Vocabulary --------------------------------------------------------------

HOLDS = "HOLDS"  # a person held or used an identifier over an interval
CONTACT = "CONTACT"  # one phone contacted another at a moment (a call row)
TRANSFER = "TRANSFER"  # one account paid another at a moment (a transaction row)
LINK = "LINK"  # a source claims two people are connected
ACCUSED = "ACCUSED"  # an FIR names this person as an accused

RECORD = "record"  # a row in a structured record
CLAIM = "claim"  # a statement in a narrative source

CALLED = "CALLED"
PAID = "PAID"
CLAIMED = "CLAIMED"
SAME_AS = "SAME_AS"
EVENT_EDGE_TYPES = (CALLED, PAID)

SUPPORTED = "supported"  # a path exists without any unreviewed identity link
LEAD = "lead"  # a path exists only through an unreviewed identity link
UNSUPPORTED = "unsupported"  # no path within the hop limit

INACTIVE_STATES = frozenset({"disputed", "rejected"})
IDENTITY_STATES = frozenset({"proposed", "accepted", "rejected", "deferred"})

ONE_DAY = timedelta(days=1)

# Search limits. Every one is reported with the result it bounded.
DEFAULT_MAX_HOPS = 3
DEFAULT_CLAIM_WINDOW_DAYS = 7
MAX_IDENTITY_STEPS = 2  # identity hops a single path may take beyond its hop budget
MAX_PATHS = 300
MAX_EXPANSIONS = 60_000
MAX_EXPLANATIONS = 12

# A person in contact with this many distinct people, who is not an accused,
# is labelled a high-activity contact. A pharmacy or a cab driver talks to
# everyone; a path through one says little about the people at either end.
HUB_MIN_COUNTERPARTS = 6


def short_hash(*parts: str, length: int = 16) -> str:
    digest = hashlib.sha256("\x1f".join(parts).encode("utf-8")).hexdigest()
    return digest[:length]


def family_key(artifact: str) -> str:
    """A source family is keyed by the original it traces back to."""
    return f"sf-{artifact[:16]}"


def candidate_key(a: str, b: str) -> str:
    left, right = sorted((a, b))
    return f"ic-{short_hash(left, right)}"


def identity_atom(candidate: str) -> str:
    return f"id:{candidate}"


def edge_key(edge_type: str, source: str, target: str) -> str:
    joiner = ">" if edge_type in EVENT_EDGE_TYPES else "~"
    return f"{edge_type}:{source}{joiner}{target}"


def finding_key(a: str, b: str) -> str:
    return f"f-{short_hash(a, b, length=12)}"


# --- Inputs ------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Assertion:
    """One statement taken from one evidence item.

    Records and claims share a shape but never a label: a statement row and an
    allegation that repeats it are different kinds of support, and every view
    keeps them apart.

    Times are timezone-aware. For HOLDS records ``start``/``end`` bound a
    half-open interval (None is unbounded). For a HOLDS claim ``start`` is the
    date the source states and ``end`` is unused: the engine applies the
    scenario's claim window, because how far a dated claim reaches is an
    assumption, not a fact of the source. For events ``start`` is the moment.
    """

    key: str
    case: str
    artifact: str
    item: str
    predicate: str
    subject: str
    object: str | None = None
    start: datetime | None = None
    end: datetime | None = None
    polarity: int = 1
    kind: str = RECORD
    detail: str | None = None
    amount: float | None = None
    subject_label: str | None = None
    object_label: str | None = None
    text: str = ""


@dataclass(frozen=True, slots=True)
class LineageLink:
    """A derivative claim traced to the claim it repeats."""

    key: str
    derivative: str
    origin: str
    basis: str  # declared_reference | near_verbatim | restates_record
    status: str  # confirmed | proposed
    score: float | None = None
    note: str = ""


@dataclass(frozen=True, slots=True)
class IdentityDecision:
    """An investigator's latest decision on one identity candidate."""

    candidate: str
    a: str
    b: str
    state: str  # accepted | rejected | deferred
    evidence: tuple[str, ...] = ()


@dataclass(frozen=True)
class Snapshot:
    """Everything a projection is computed from, already scoped to what the
    caller may see. Scoping happens before this object exists, never after."""

    cases: tuple[str, ...]
    assertions: tuple[Assertion, ...]
    links: tuple[LineageLink, ...] = ()
    decisions: tuple[IdentityDecision, ...] = ()
    reviews: Mapping[str, str] = field(default_factory=dict)
    groupings: Mapping[str, str] = field(default_factory=dict)

    def assertion_map(self) -> dict[str, Assertion]:
        return {a.key: a for a in self.assertions}


@dataclass(frozen=True)
class Scenario:
    """A named alternative to the baseline. Every field is a stated assumption.

    Overrides are tuples of pairs so a scenario is hashable and has one
    canonical serialisation, which is what caches, exports and the verifier
    key on.
    """

    exclude_families: frozenset[str] = frozenset()
    identity: tuple[tuple[str, str], ...] = ()
    assertions: tuple[tuple[str, str], ...] = ()
    groupings: tuple[tuple[str, str], ...] = ()
    claim_window_days: int = DEFAULT_CLAIM_WINDOW_DAYS
    provisional_identities: bool = True
    max_hops: int = DEFAULT_MAX_HOPS
    naive: bool = False

    @classmethod
    def build(
        cls,
        *,
        exclude_families: Iterable[str] = (),
        identity: Mapping[str, str] | None = None,
        assertions: Mapping[str, str] | None = None,
        groupings: Mapping[str, str] | None = None,
        **options,
    ) -> Scenario:
        return cls(
            exclude_families=frozenset(exclude_families),
            identity=tuple(sorted((identity or {}).items())),
            assertions=tuple(sorted((assertions or {}).items())),
            groupings=tuple(sorted((groupings or {}).items())),
            **options,
        )

    def to_dict(self) -> dict:
        return {
            "exclude_families": sorted(self.exclude_families),
            "identity": dict(self.identity),
            "assertions": dict(self.assertions),
            "groupings": dict(self.groupings),
            "claim_window_days": self.claim_window_days,
            "provisional_identities": self.provisional_identities,
            "max_hops": self.max_hops,
            "naive": self.naive,
        }

    @classmethod
    def from_dict(cls, data: Mapping) -> Scenario:
        return cls.build(
            exclude_families=data.get("exclude_families", ()),
            identity=data.get("identity") or {},
            assertions=data.get("assertions") or {},
            groupings=data.get("groupings") or {},
            claim_window_days=int(data.get("claim_window_days", DEFAULT_CLAIM_WINDOW_DAYS)),
            provisional_identities=bool(data.get("provisional_identities", True)),
            max_hops=int(data.get("max_hops", DEFAULT_MAX_HOPS)),
            naive=bool(data.get("naive", False)),
        )

    def canonical(self) -> str:
        return json.dumps(self.to_dict(), sort_keys=True, separators=(",", ":"))

    def fingerprint(self) -> str:
        return short_hash(self.canonical())


BASELINE = Scenario()


# --- Outputs -----------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Person:
    key: str
    case: str
    label: str
    mentions: frozenset[str]


@dataclass(frozen=True, slots=True)
class Edge:
    key: str
    type: str
    source: str
    target: str
    derivations: frozenset[frozenset[str]]
    provisional: bool = False

    @property
    def directed(self) -> bool:
        return self.type in EVENT_EDGE_TYPES


@dataclass(frozen=True, slots=True)
class SharedIdentifier:
    identifier: str
    holding_a: str
    holding_b: str
    overlapping: bool


@dataclass(frozen=True, slots=True)
class Candidate:
    """A proposed cross-case identity and what, if anything, was decided."""

    key: str
    a: str
    b: str
    name_match: bool
    shared: tuple[SharedIdentifier, ...]
    status: str  # proposed | accepted | rejected | deferred (after scenario overrides)
    in_effect: bool  # contributes a SAME_AS edge in this projection
    provisional: bool  # in effect only because unreviewed candidates are allowed


@dataclass(frozen=True, slots=True)
class Conflict:
    """At the moment of an event, more than one distinct person holds a number."""

    identifier: str
    event: str
    at: datetime
    holders: tuple[tuple[str, str], ...]  # (person key, HOLDS assertion key)


@dataclass(frozen=True, slots=True)
class Step:
    source: str
    target: str
    edges: tuple[str, ...]
    identity: bool
    provisional: bool


@dataclass(frozen=True, slots=True)
class Explanation:
    """One chain of people connecting a finding's two ends."""

    key: str
    nodes: tuple[str, ...]
    steps: tuple[Step, ...]
    status: str
    hops: int
    provisional: tuple[str, ...]
    hubs: tuple[str, ...]
    alternatives: int


@dataclass(frozen=True, slots=True)
class Finding:
    """Two accused, in two different cases, joined by at least one path."""

    key: str
    a: str
    b: str
    case_a: str
    case_b: str
    status: str
    distance: int
    explanations: tuple[Explanation, ...]
    paths_found: int
    truncated: bool


@dataclass(frozen=True)
class Projection:
    scenario: Scenario
    families: Mapping[str, str]
    roots: Mapping[str, str]
    active: frozenset[str]
    persons: Mapping[str, Person]
    edges: Mapping[str, Edge]
    candidates: Mapping[str, Candidate]
    conflicts: tuple[Conflict, ...]
    denials: tuple[tuple[str, str, str], ...]
    anchors: Mapping[str, frozenset[str]]
    hubs: frozenset[str]
    findings: Mapping[str, Finding]


# --- Families ------------------------------------------------------------------


def lineage_roots(snapshot: Snapshot, scenario: Scenario = BASELINE) -> dict[str, str]:
    """The original statement each assertion traces back to (itself if none).

    Proposed links apply until someone rejects them: a repeat is not counted
    as corroboration before anyone has looked, which errs toward understating
    support rather than inflating it.
    """
    states = {**snapshot.groupings, **dict(scenario.groupings)}
    parent: dict[str, str] = {}
    for link in sorted(snapshot.links, key=lambda item: item.key):
        if states.get(link.key) == "rejected":
            continue
        # One origin per derivative, chosen deterministically by link key.
        parent.setdefault(link.derivative, link.origin)

    roots: dict[str, str] = {}
    for assertion in snapshot.assertions:
        root = assertion.key
        seen = {root}
        while root in parent and parent[root] not in seen:
            root = parent[root]
            seen.add(root)
        roots[assertion.key] = root
    return roots


def assign_families(snapshot: Snapshot, scenario: Scenario = BASELINE) -> dict[str, str]:
    """Source family of every assertion in the snapshot.

    By default an assertion's family is its own original. A lineage link moves
    a derivative claim into the family of the claim it repeats, so withdrawing
    an origin withdraws its copies with it.
    """
    artifact_of = {a.key: a.artifact for a in snapshot.assertions}
    return {
        key: family_key(artifact_of.get(root, artifact_of[key]))
        for key, root in lineage_roots(snapshot, scenario).items()
    }


# --- Derivation ------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class _Holding:
    person: str
    identifier: str
    start: datetime | None
    end: datetime | None
    key: str
    dated: bool


def _covers(holding: _Holding, moment: datetime) -> bool:
    if not holding.dated:
        return False
    if holding.start is not None and moment < holding.start:
        return False
    return holding.end is None or moment < holding.end


def _overlap(left: _Holding, right: _Holding) -> bool:
    if not (left.dated and right.dated):
        return False
    starts = [s for s in (left.start, right.start) if s is not None]
    ends = [e for e in (left.end, right.end) if e is not None]
    latest_start = max(starts) if starts else None
    earliest_end = min(ends) if ends else None
    return latest_start is None or earliest_end is None or latest_start < earliest_end


def _holdings(active: list[Assertion], window: timedelta) -> dict[str, list[_Holding]]:
    """Who held which identifier when, from records and dated claims."""
    by_identifier: dict[str, list[_Holding]] = defaultdict(list)
    for a in active:
        if a.predicate != HOLDS or a.polarity < 0 or a.object is None:
            continue
        if a.kind == CLAIM:
            # A claim says "X used this number around this date". How far that
            # reaches either side is the scenario's window, never the source's.
            if a.start is None:
                holding = _Holding(a.subject, a.object, None, None, a.key, dated=False)
            else:
                holding = _Holding(
                    a.subject, a.object, a.start - window, a.start + window + ONE_DAY, a.key, True
                )
        else:
            holding = _Holding(a.subject, a.object, a.start, a.end, a.key, dated=True)
        by_identifier[a.object].append(holding)
    for entries in by_identifier.values():
        entries.sort(key=lambda h: h.key)
    return by_identifier


def _holders_at(entries: Iterable[_Holding], moment: datetime) -> list[tuple[str, str]]:
    return [(h.person, h.key) for h in entries if _covers(h, moment)]


def _person_refs(a: Assertion) -> Iterable[tuple[str, str | None]]:
    if a.predicate in (HOLDS, ACCUSED):
        yield a.subject, a.subject_label
    elif a.predicate == LINK:
        yield a.subject, a.subject_label
        if a.object is not None:
            yield a.object, a.object_label


def _display_label(surfaces: Counter) -> str:
    """Most frequent surface; ties prefer prose case over record capitals."""
    return max(
        surfaces,
        key=lambda s: (surfaces[s], not s.isupper(), "," not in s, len(s), s),
    )


def _people(active: list[Assertion]) -> dict[str, Person]:
    mentions: dict[str, set[str]] = defaultdict(set)
    surfaces: dict[str, Counter] = defaultdict(Counter)
    for a in active:
        for key, label in _person_refs(a):
            mentions[key].add(a.key)
            surfaces[key][(label or name_of(key)).strip()] += 1
    return {
        key: Person(
            key=key,
            case=case_of(key),
            label=_display_label(surfaces[key]),
            mentions=frozenset(mentions[key]),
        )
        for key in sorted(mentions)
    }


def _active(
    snapshot: Snapshot,
    scenario: Scenario,
    families: Mapping[str, str],
    roots: Mapping[str, str],
) -> list[Assertion]:
    """Assertions in play. Disputing an origin disputes its copies too: a
    repeat has no basis of its own to stand on once its source is doubted."""
    states = {**snapshot.reviews, **dict(scenario.assertions)}
    in_scope = set(snapshot.cases)
    return [
        a
        for a in snapshot.assertions
        if a.case in in_scope
        and states.get(a.key) not in INACTIVE_STATES
        and states.get(roots.get(a.key, a.key)) not in INACTIVE_STATES
        and families[a.key] not in scenario.exclude_families
    ]


def _event_derivations(
    active: list[Assertion],
    holdings: Mapping[str, list[_Holding]],
    derivations: dict[tuple[str, str, str], set[frozenset[str]]],
) -> list[Assertion]:
    events = sorted(
        (a for a in active if a.predicate in (CONTACT, TRANSFER) and a.start is not None),
        key=lambda a: a.key,
    )
    for event in events:
        edge_type = CALLED if event.predicate == CONTACT else PAID
        callers = _holders_at(holdings.get(event.subject, ()), event.start)
        callees = _holders_at(holdings.get(event.object or "", ()), event.start)
        for person_a, holding_a in callers:
            for person_b, holding_b in callees:
                if person_a == person_b:
                    continue
                derivations[(edge_type, person_a, person_b)].add(
                    frozenset({event.key, holding_a, holding_b})
                )
    return events


def _claim_derivations(
    active: list[Assertion],
    derivations: dict[tuple[str, str, str], set[frozenset[str]]],
) -> list[tuple[str, str, str]]:
    denials: list[tuple[str, str, str]] = []
    for a in active:
        if a.predicate != LINK or a.object is None or a.subject == a.object:
            continue
        left, right = sorted((a.subject, a.object))
        if a.polarity < 0:
            denials.append((left, right, a.key))
        else:
            derivations[(CLAIMED, left, right)].add(frozenset({a.key}))
    denials.sort()
    return denials


def _candidates(
    people: Mapping[str, Person],
    holdings: Mapping[str, list[_Holding]],
    snapshot: Snapshot,
    scenario: Scenario,
    active_keys: frozenset[str],
    derivations: dict[tuple[str, str, str], set[frozenset[str]]],
    provisional_edges: set[tuple[str, str]],
) -> dict[str, Candidate]:
    """Generate cross-case identity candidates and apply decisions.

    A candidate needs a name match or an identifier both people held at
    overlapping times. The same number held in different periods is not a
    basis on its own: reassigned numbers are common, and treating them as
    identity is how one subscriber's history gets pinned on another.
    """
    held_by: dict[str, list[_Holding]] = defaultdict(list)
    for entries in holdings.values():
        for holding in entries:
            if holding.dated:
                held_by[holding.person].append(holding)

    decisions = {d.candidate: d for d in snapshot.decisions}
    overrides = dict(scenario.identity)

    result: dict[str, Candidate] = {}
    for a, b in combinations(sorted(people), 2):
        if people[a].case == people[b].case:
            continue
        key = candidate_key(a, b)
        name_match = names_match(name_of(a), name_of(b))
        shared = tuple(
            sorted(
                (
                    SharedIdentifier(h_a.identifier, h_a.key, h_b.key, _overlap(h_a, h_b))
                    for h_a in held_by.get(a, ())
                    for h_b in held_by.get(b, ())
                    if h_a.identifier == h_b.identifier
                ),
                key=lambda s: (s.identifier, s.holding_a, s.holding_b),
            )
        )
        overlapping = [s for s in shared if s.overlapping]
        decision = decisions.get(key)
        if not (name_match or overlapping or decision or key in overrides):
            continue

        status = overrides.get(key) or (decision.state if decision else "proposed")
        atom = identity_atom(key)
        basis: set[frozenset[str]] = set()
        if name_match:
            basis.add(frozenset({atom}))
        for s in overlapping:
            basis.add(frozenset({atom, s.holding_a, s.holding_b}))

        if status == "accepted" and key not in overrides and decision is not None:
            # A recorded decision stands only on the evidence it cited. Withdraw
            # all of that and the decision no longer holds.
            support = {frozenset({atom, e}) for e in decision.evidence if e in active_keys}
            provisional = False
        elif status == "accepted":
            support, provisional = basis, False
        elif status in ("proposed", "deferred") and scenario.provisional_identities:
            support, provisional = basis, True
        else:
            support, provisional = set(), False

        if support:
            derivations[(SAME_AS, a, b)] |= support
            if provisional:
                provisional_edges.add((a, b))

        result[key] = Candidate(
            key=key,
            a=a,
            b=b,
            name_match=name_match,
            shared=shared,
            status=status,
            in_effect=bool(support),
            provisional=provisional and bool(support),
        )
    return result


class _UnionFind:
    def __init__(self) -> None:
        self.parent: dict[str, str] = {}

    def find(self, item: str) -> str:
        self.parent.setdefault(item, item)
        while self.parent[item] != item:
            self.parent[item] = self.parent[self.parent[item]]
            item = self.parent[item]
        return item

    def union(self, left: str, right: str) -> None:
        a, b = self.find(left), self.find(right)
        if a != b:
            self.parent[max(a, b)] = min(a, b)


def _conflicts(
    events: list[Assertion],
    holdings: Mapping[str, list[_Holding]],
    edges: Mapping[str, Edge],
) -> tuple[Conflict, ...]:
    """Events whose number was held by distinct people at that moment.

    People joined by any identity link, even a provisional one, are not in
    conflict: that is an identity question, raised separately.
    """
    linked = _UnionFind()
    for edge in edges.values():
        if edge.type == SAME_AS:
            linked.union(edge.source, edge.target)

    found: list[Conflict] = []
    for event in events:
        for identifier in (event.subject, event.object):
            if identifier is None:
                continue
            holders = _holders_at(holdings.get(identifier, ()), event.start)
            if len({linked.find(person) for person, _ in holders}) > 1:
                found.append(Conflict(identifier, event.key, event.start, tuple(sorted(holders))))
    return tuple(found)


def clusters_of(edges: Iterable[Edge]) -> _UnionFind:
    """References joined by any identity link, reviewed or not."""
    clusters = _UnionFind()
    for edge in edges:
        if edge.type == SAME_AS:
            clusters.union(edge.source, edge.target)
    return clusters


def hubs_for(edges: Mapping[str, Edge], anchors: Mapping[str, frozenset[str]]) -> frozenset[str]:
    """People in record contact with many distinct others, accused excepted.

    Counterparts are counted per identity cluster, so one person filed under
    three case references counts once, and another reference of an accused is
    never mistaken for a busy stranger.
    """
    clusters = clusters_of(edges.values())
    accused = {clusters.find(anchor) for anchor in anchors}
    counterparts: dict[str, set[str]] = defaultdict(set)
    for edge in edges.values():
        if edge.type not in EVENT_EDGE_TYPES:
            continue
        left, right = clusters.find(edge.source), clusters.find(edge.target)
        if left != right:
            counterparts[edge.source].add(right)
            counterparts[edge.target].add(left)
    return frozenset(
        person
        for person, others in counterparts.items()
        if len(others) >= HUB_MIN_COUNTERPARTS and clusters.find(person) not in accused
    )


def _build_edges(
    derivations: Mapping[tuple[str, str, str], set[frozenset[str]]],
    people: Mapping[str, Person],
    provisional_edges: set[tuple[str, str]],
) -> dict[str, Edge]:
    edges: dict[str, Edge] = {}
    for (edge_type, source, target), support in sorted(derivations.items()):
        if not support or source not in people or target not in people:
            continue
        key = edge_key(edge_type, source, target)
        edges[key] = Edge(
            key=key,
            type=edge_type,
            source=source,
            target=target,
            derivations=frozenset(support),
            provisional=edge_type == SAME_AS and (source, target) in provisional_edges,
        )
    return edges


def derive(
    snapshot: Snapshot,
    scenario: Scenario = BASELINE,
    *,
    subjects: Iterable[str] | None = None,
) -> Projection:
    """Compute a full projection from scratch. The reference implementation.

    ``subjects`` fixes the question: which accused are being compared. A
    scenario that withdraws the FIR naming someone still asks about them; it
    just may no longer find anything. When omitted, subjects are read from the
    active ACCUSED assertions.
    """
    if scenario.naive:
        return _derive_naive(snapshot, scenario, subjects)

    roots = lineage_roots(snapshot, scenario)
    artifact_of = {a.key: a.artifact for a in snapshot.assertions}
    families = {key: family_key(artifact_of[root]) for key, root in roots.items()}
    active = _active(snapshot, scenario, families, roots)
    people = _people(active)
    holdings = _holdings(active, timedelta(days=scenario.claim_window_days))

    derivations: dict[tuple[str, str, str], set[frozenset[str]]] = defaultdict(set)
    events = _event_derivations(active, holdings, derivations)
    denials = _claim_derivations(active, derivations)

    provisional_edges: set[tuple[str, str]] = set()
    active_keys = frozenset(a.key for a in active)
    candidates = _candidates(
        people, holdings, snapshot, scenario, active_keys, derivations, provisional_edges
    )
    edges = _build_edges(derivations, people, provisional_edges)

    if subjects is None:
        subjects = sorted({a.subject for a in active if a.predicate == ACCUSED and a.polarity > 0})
    anchors = {s: frozenset({case_of(s)}) for s in subjects}
    hubs = hubs_for(edges, anchors)

    return Projection(
        scenario=scenario,
        families=families,
        roots=roots,
        active=frozenset(a.key for a in active),
        persons=people,
        edges=edges,
        candidates=candidates,
        conflicts=_conflicts(events, holdings, edges),
        denials=tuple(denials),
        anchors=anchors,
        hubs=hubs,
        findings=compute_findings(people, edges, anchors, hubs, scenario.max_hops),
    )


def _derive_naive(
    snapshot: Snapshot, scenario: Scenario, subjects: Iterable[str] | None
) -> Projection:
    """What an ordinary resolved graph would conclude, for comparison only.

    Three simplifications, each one a failure MASTER_PLAN.md names: every
    same-named person is one person across all cases; every identifier belongs
    to everyone ever recorded against it, at every moment; and every document
    counts as an independent source. Nothing here is shown as a finding of
    this system, only as the contrast.
    """
    anchors: dict[str, set[str]] = defaultdict(set)
    rewritten: list[Assertion] = []

    def merge(key: str | None) -> str | None:
        if key is None or not is_person(key):
            return key
        return f"P:ALL:{name_of(key)}"

    for a in snapshot.assertions:
        if a.case not in snapshot.cases:
            continue
        changes: dict = {"subject": merge(a.subject), "object": merge(a.object)}
        if a.predicate == HOLDS:
            changes.update(start=None, end=None, kind=RECORD)
        rewritten.append(replace(a, **changes))
        if a.predicate == ACCUSED and a.polarity > 0:
            anchors[merge(a.subject)].add(a.case)

    naive_snapshot = Snapshot(cases=snapshot.cases, assertions=tuple(rewritten))
    roots = {a.key: a.key for a in rewritten}
    families = assign_families(naive_snapshot)
    active = _active(naive_snapshot, scenario, families, roots)
    people = _people(active)
    holdings = _holdings(active, timedelta(days=scenario.claim_window_days))

    derivations: dict[tuple[str, str, str], set[frozenset[str]]] = defaultdict(set)
    _event_derivations(active, holdings, derivations)
    denials = _claim_derivations(active, derivations)
    edges = _build_edges(derivations, people, set())

    if subjects is not None:
        wanted = {merge(s) for s in subjects}
        anchors = {k: v for k, v in anchors.items() if k in wanted}
    frozen_anchors = {k: frozenset(v) for k, v in anchors.items()}
    # An ordinary graph does not discount busy contacts either.
    hubs: frozenset[str] = frozenset()

    return Projection(
        scenario=scenario,
        families=families,
        roots=roots,
        active=frozenset(a.key for a in active),
        persons=people,
        edges=edges,
        candidates={},
        conflicts=(),
        denials=tuple(denials),
        anchors=frozen_anchors,
        hubs=hubs,
        findings=compute_findings(people, edges, frozen_anchors, hubs, scenario.max_hops),
    )


# --- Paths and findings ------------------------------------------------------------

Adjacency = dict[str, dict[str, list[Edge]]]


def adjacency(edges: Iterable[Edge]) -> Adjacency:
    graph: Adjacency = defaultdict(lambda: defaultdict(list))
    for edge in edges:
        graph[edge.source][edge.target].append(edge)
        graph[edge.target][edge.source].append(edge)
    return graph


def _step_cost(bundle: list[Edge], allow_provisional: bool) -> int | None:
    usable = [e for e in bundle if allow_provisional or not e.provisional]
    if not usable:
        return None
    return 0 if any(e.type == SAME_AS for e in usable) else 1


def distance(
    graph: Adjacency,
    source: str,
    target: str,
    limit: int,
    *,
    allow_provisional: bool,
    blocked: frozenset[str] = frozenset(),
) -> int | None:
    """Fewest non-identity hops from source to target, or None beyond limit.

    Identity hops cost nothing: walking from one reference to another
    reference of the same person is not a step away from them. ``blocked``
    people may end a path but never carry one. 0-1 BFS keeps this exact, which
    matters because sensitivity trusts it as the oracle for whether a finding
    still holds.
    """
    if source not in graph or target not in graph:
        return None
    if source == target:
        return 0
    best = {source: 0}
    queue: deque[tuple[int, str]] = deque([(0, source)])
    while queue:
        cost, node = queue.popleft()
        if cost > best.get(node, limit + 1):
            continue
        if node == target:
            return cost
        if node in blocked and node != source:
            continue
        for neighbor in sorted(graph[node]):
            step = _step_cost(graph[node][neighbor], allow_provisional)
            if step is None:
                continue
            reached = cost + step
            if reached > limit or reached >= best.get(neighbor, limit + 1):
                continue
            best[neighbor] = reached
            if step == 0:
                queue.appendleft((reached, neighbor))
            else:
                queue.append((reached, neighbor))
    return None


def distances_from(graph: Adjacency, source: str, limit: int) -> dict[str, int]:
    """Fewest non-identity hops from source to everyone within limit."""
    best = {source: 0}
    queue: deque[tuple[int, str]] = deque([(0, source)])
    while queue:
        cost, node = queue.popleft()
        if cost > best[node]:
            continue
        for neighbor in sorted(graph.get(node, {})):
            step = _step_cost(graph[node][neighbor], True)
            if step is None:
                continue
            reached = cost + step
            if reached > limit or reached >= best.get(neighbor, limit + 1):
                continue
            best[neighbor] = reached
            if step == 0:
                queue.appendleft((reached, neighbor))
            else:
                queue.append((reached, neighbor))
    return best


def relevant_edges(projection: Projection, finding: Finding) -> list[Edge]:
    """Every edge that could lie on some path of this finding within the limit.

    A person is relevant when the hops from one end plus the hops to the other
    fit the limit. Over-inclusive by design: the sensitivity search must not
    miss a family that a path could use, and extra candidates only cost time.
    """
    graph = adjacency(projection.edges.values())
    limit = projection.scenario.max_hops
    from_a = distances_from(graph, finding.a, limit)
    from_b = distances_from(graph, finding.b, limit)
    near = {n for n, d in from_a.items() if d + from_b.get(n, limit + 1) <= limit}
    return [e for e in projection.edges.values() if e.source in near and e.target in near]


def _paths(
    graph: Adjacency, source: str, target: str, limit: int, clusters: _UnionFind
) -> tuple[list[tuple[str, ...]], bool]:
    """Paths in order of cost, then length. Capped, and says so.

    Simple at the level of people, not just references: a path may step from
    one reference of a person to another, but once it leaves a person it never
    comes back to them under a different case reference. "Deepak -> Pappu (BM-2)
    -> Anil -> Pappu (BM-3)" is not an explanation of anything.
    """
    start = clusters.find(source)
    heap: list[tuple[int, int, tuple[str, ...], frozenset[str]]] = [
        (0, 0, (source,), frozenset({start}))
    ]
    found: list[tuple[str, ...]] = []
    expansions = 0
    while heap:
        cost, length, path, visited = heappop(heap)
        node = path[-1]
        if node == target:
            found.append(path)
            if len(found) >= MAX_PATHS:
                return found, bool(heap)
            continue
        expansions += 1
        if expansions > MAX_EXPANSIONS:
            return found, True
        here = clusters.find(node)
        for neighbor in sorted(graph[node]):
            if neighbor in path:
                continue
            there = clusters.find(neighbor)
            if there != here and there in visited:
                continue
            step = _step_cost(graph[node][neighbor], True)
            if step is None:
                continue
            if cost + step > limit or length + 1 > limit + MAX_IDENTITY_STEPS:
                continue
            heappush(heap, (cost + step, length + 1, (*path, neighbor), visited | {there}))
    return found, False


def _explain(path: tuple[str, ...], graph: Adjacency, hubs: frozenset[str]) -> Explanation:
    steps: list[Step] = []
    provisional: set[str] = set()
    for left, right in pairwise(path):
        bundle = graph[left][right]
        identities = [e for e in bundle if e.type == SAME_AS]
        firm_identities = [e for e in identities if not e.provisional]
        others = [e for e in bundle if e.type != SAME_AS]
        if firm_identities:
            keys = tuple(sorted(e.key for e in firm_identities))
            steps.append(Step(left, right, keys, True, False))
        elif others:
            # A firm relationship between the two references carries this hop
            # on its own, so the unreviewed identity beside it is not assumed.
            steps.append(Step(left, right, tuple(sorted(e.key for e in others)), False, False))
        else:
            provisional.add(candidate_key(left, right))
            keys = tuple(sorted(e.key for e in identities))
            steps.append(Step(left, right, keys, True, True))
    through_hubs = tuple(n for n in path[1:-1] if n in hubs)
    return Explanation(
        key=f"x-{short_hash(*path, length=12)}",
        nodes=path,
        steps=tuple(steps),
        status=LEAD if provisional or through_hubs else SUPPORTED,
        hops=sum(1 for s in steps if not s.identity),
        provisional=tuple(sorted(provisional)),
        hubs=through_hubs,
        alternatives=0,
    )


def _cluster_signature(explanation: Explanation, clusters: _UnionFind) -> tuple[str, ...]:
    """The chain of people an explanation walks, identity detours collapsed."""
    signature: list[str] = []
    for node in explanation.nodes:
        root = clusters.find(node)
        if not signature or signature[-1] != root:
            signature.append(root)
    return tuple(signature)


def _explanations(
    paths: list[tuple[str, ...]], graph: Adjacency, hubs: frozenset[str], clusters: _UnionFind
) -> tuple[tuple[Explanation, ...], bool]:
    """Group routings of the same chain of people; keep the firmest of each.

    Rohit Vaze in one file and Rohit Vaze in another may both touch the same
    counterpart. Walking through either reference is one explanation, not two,
    so variants are grouped and the one assuming least is shown.
    """
    grouped: dict[tuple[str, ...], list[Explanation]] = defaultdict(list)
    for path in paths:
        explanation = _explain(path, graph, hubs)
        grouped[_cluster_signature(explanation, clusters)].append(explanation)

    best: list[Explanation] = []
    for variants in grouped.values():
        variants.sort(
            key=lambda e: (
                e.status != SUPPORTED,
                len(e.provisional),
                sum(1 for s in e.steps if s.identity),
                len(e.nodes),
                e.nodes,
            )
        )
        best.append(replace(variants[0], alternatives=len(variants) - 1))

    best.sort(key=lambda e: (e.status != SUPPORTED, e.hops, len(e.hubs), len(e.provisional), e.key))
    return tuple(best[:MAX_EXPLANATIONS]), len(best) > MAX_EXPLANATIONS


def _firm_distance(
    graph: Adjacency, a: str, b: str, max_hops: int, hubs: frozenset[str]
) -> int | None:
    """Support without assumptions: no unreviewed identity, no busy stranger."""
    return distance(graph, a, b, max_hops, allow_provisional=False, blocked=hubs)


def compute_findings(
    people: Mapping[str, Person],
    edges: Mapping[str, Edge],
    anchors: Mapping[str, frozenset[str]],
    hubs: frozenset[str],
    max_hops: int,
) -> dict[str, Finding]:
    """Every pair of accused from two different cases that a path joins.

    Supported means a path exists that assumes nothing: no unreviewed identity
    link and no high-activity contact carrying it. Anything weaker is a lead,
    and says which of the two it leans on.
    """
    graph = adjacency(edges.values())
    clusters = clusters_of(edges.values())
    by_case: dict[str, list[str]] = defaultdict(list)
    for subject, cases in anchors.items():
        if subject in people:
            for case in cases:
                by_case[case].append(subject)

    findings: dict[str, Finding] = {}
    for case_a, case_b in combinations(sorted(by_case), 2):
        for a in sorted(by_case[case_a]):
            for b in sorted(by_case[case_b]):
                if a == b:
                    continue
                full = distance(graph, a, b, max_hops, allow_provisional=True)
                if full is None:
                    continue
                firm = _firm_distance(graph, a, b, max_hops, hubs)
                paths, capped = _paths(graph, a, b, max_hops, clusters)
                explanations, more = _explanations(paths, graph, hubs, clusters)
                key = finding_key(a, b)
                findings[key] = Finding(
                    key=key,
                    a=a,
                    b=b,
                    case_a=case_a,
                    case_b=case_b,
                    status=SUPPORTED if firm is not None else LEAD,
                    distance=full if firm is None else firm,
                    explanations=explanations,
                    paths_found=len(paths),
                    truncated=capped or more,
                )
    return findings


def finding_status(
    edges: Mapping[str, Edge],
    finding: Finding,
    max_hops: int,
    anchors: Mapping[str, frozenset[str]],
) -> str:
    """Status of a fixed question against an edge set. Used by sensitivity.

    Hubs are recomputed from these edges rather than carried over: withdrawing
    evidence can change who counts as a high-activity contact, and a from-scratch
    derive would see that change too.
    """
    graph = adjacency(edges.values())
    hubs = hubs_for(edges, anchors)
    if _firm_distance(graph, finding.a, finding.b, max_hops, hubs) is not None:
        return SUPPORTED
    if distance(graph, finding.a, finding.b, max_hops, allow_provisional=True) is not None:
        return LEAD
    return UNSUPPORTED


def restrict(projection: Projection, excluded: Iterable[str]) -> dict[str, Edge]:
    """The baseline's edges with every derivation touching ``excluded`` removed.

    ``excluded`` holds assertion keys and identity atoms. A person with no
    remaining mention disappears, and so does every edge at them. This is the
    fast path the sensitivity search runs hundreds of times; tests hold it to
    exact agreement with a from-scratch ``derive``.
    """
    removed = frozenset(excluded)
    alive = {key for key, person in projection.persons.items() if person.mentions - removed}
    kept: dict[str, Edge] = {}
    for key, edge in projection.edges.items():
        if edge.source not in alive or edge.target not in alive:
            continue
        support = frozenset(d for d in edge.derivations if not d & removed)
        if support:
            kept[key] = edge if support == edge.derivations else replace(edge, derivations=support)
    return kept


def atoms_of(edge: Edge) -> frozenset[str]:
    return frozenset().union(*edge.derivations) if edge.derivations else frozenset()


def explanation_atoms(explanation: Explanation, edges: Mapping[str, Edge]) -> frozenset[str]:
    atoms: set[str] = set()
    for step in explanation.steps:
        for key in step.edges:
            edge = edges.get(key)
            if edge is not None:
                atoms |= atoms_of(edge)
    return frozenset(atoms)
