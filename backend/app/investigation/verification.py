"""Which check would change the most: verification planning.

Consumed by investigation.service.

A task is an existing record or passage an investigator can check, the
concrete outcomes that check could have, and what each outcome would do to the
findings. Every outcome, including "inconclusive", is computed by rerunning the
engine rather than estimated.

Priority is shown as its components and sorted by them in this order:

    grounds         what prompts the check. A contradiction already in the
                    evidence (a record says one person, a claim another) comes
                    first; then an assumption nobody has reviewed (an identity,
                    a grouping of copies); then a source that happens to carry a
                    finding alone, which nothing yet contradicts.
    status changes  findings whose status differs between outcomes
    explanations    explanations that differ between outcomes
    availability    whether the record is already in the workspace
    effort          how many rows and passages there are to read

There is no blended score. A weighting would look like precision it does not
have, and expected information gain needs calibrated outcome probabilities that
a synthetic scenario cannot supply. Grounds come first because the other
components measure how much an answer would matter, not whether there is any
reason to doubt the current one: without that, "is this whole call export
wrong?" outranks "which of these two sources is right about this number?" on
every scenario, and a reviewer spends the first check where nothing was in
doubt.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping
from dataclasses import dataclass

from app.investigation import engine as E
from app.investigation.normalize import identifier_value
from app.investigation.sensitivity import _passage, _with

IN_WORKSPACE = "in workspace"

CONTRADICTION = "contradiction"
ASSUMPTION = "unreviewed assumption"
DEPENDENCY = "single-source dependency"
GROUNDS = {
    "attribution": CONTRADICTION,
    "identity": ASSUMPTION,
    "lineage": ASSUMPTION,
    "critical_source": DEPENDENCY,
}
GROUNDS_ORDER = {CONTRADICTION: 0, ASSUMPTION: 1, DEPENDENCY: 2}


@dataclass(frozen=True)
class Outcome:
    key: str
    label: str
    overrides: dict
    statuses: dict[str, str]
    explanations: frozenset[tuple[str, str, str]]


@dataclass(frozen=True)
class Task:
    key: str
    kind: str  # attribution | identity | lineage | critical_source
    title: str
    question: str
    evidence: tuple[str, ...]
    effort: int
    availability: str
    outcomes: tuple[Outcome, ...]
    status_changes: int
    explanation_changes: int
    affected: tuple[str, ...]
    # What the task is about: the candidate, the lineage links, the source
    # family, or the number, so an answer can be recorded against it directly.
    targets: tuple[str, ...] = ()

    @property
    def grounds(self) -> str:
        return GROUNDS[self.kind]

    def priority(self) -> tuple:
        return (
            GROUNDS_ORDER[self.grounds],
            -self.status_changes,
            -self.explanation_changes,
            self.availability != IN_WORKSPACE,
            self.effort,
            self.key,
        )


def _evaluate(
    snapshot: E.Snapshot, baseline: E.Projection, key: str, label: str, overrides: dict
) -> Outcome:
    scenario = _with(baseline.scenario, **overrides) if overrides else baseline.scenario
    projection = E.derive(snapshot, scenario, subjects=sorted(baseline.anchors))
    statuses = {k: f.status for k, f in projection.findings.items()}
    explanations = frozenset(
        (fk, x.key, x.status) for fk, f in projection.findings.items() for x in f.explanations
    )
    return Outcome(key, label, overrides, statuses, explanations)


def _task(
    key: str,
    kind: str,
    title: str,
    question: str,
    evidence: set[str],
    outcomes: list[Outcome],
    baseline: E.Projection,
    snapshot: E.Snapshot,
    targets: tuple[str, ...] = (),
) -> Task:
    findings = sorted(baseline.findings)
    affected = tuple(
        f for f in findings if len({o.statuses.get(f, E.UNSUPPORTED) for o in outcomes}) > 1
    )
    union = frozenset().union(*(o.explanations for o in outcomes))
    common = frozenset.intersection(*(o.explanations for o in outcomes))
    by_key = snapshot.assertion_map()
    # Effort is what a person has to read: distinct rows and passages.
    items = {(by_key[k].artifact, by_key[k].item) for k in evidence if k in by_key}
    return Task(
        key=key,
        kind=kind,
        title=title,
        question=question,
        evidence=tuple(sorted(evidence)),
        effort=len(items),
        availability=IN_WORKSPACE,
        outcomes=tuple(outcomes),
        status_changes=len(affected),
        explanation_changes=len(union - common),
        affected=affected,
        targets=targets,
    )


def _used_edges(baseline: E.Projection) -> set[str]:
    return {
        edge
        for finding in baseline.findings.values()
        for explanation in finding.explanations
        for step in explanation.steps
        for edge in step.edges
    }


def plan(
    snapshot: E.Snapshot,
    baseline: E.Projection,
    artifact_names: Mapping[str, str],
    *,
    limit: int = 12,
) -> list[Task]:
    by_key = snapshot.assertion_map()
    persons = baseline.persons

    def who(person: str) -> str:
        found = persons.get(person)
        return f"{found.label} ({found.case})" if found else person

    def doc(assertion_key: str) -> str:
        return artifact_names.get(by_key[assertion_key].artifact, "an original")

    inconclusive = _evaluate(
        snapshot, baseline, "inconclusive", "Inconclusive: nothing changes", {}
    )
    used = _used_edges(baseline)
    used_atoms = {
        atom
        for key in used
        if key in baseline.edges
        for d in baseline.edges[key].derivations
        for atom in d
    }
    tasks: list[Task] = []

    # 1. Who held a number when two sources disagree about the same moment.
    groups: dict[tuple[str, frozenset[str]], dict] = {}
    for conflict in baseline.conflicts:
        if conflict.event not in used_atoms:
            continue
        people = frozenset(person for person, _ in conflict.holders)
        group = groups.setdefault(
            (conflict.identifier, people), {"events": set(), "holdings": defaultdict(set)}
        )
        group["events"].add(conflict.event)
        for person, holding in conflict.holders:
            group["holdings"][person].add(holding)

    for (identifier, people), group in sorted(
        groups.items(), key=lambda kv: (kv[0][0], sorted(kv[0][1]))
    ):
        moments = sorted(by_key[e].start for e in group["events"])
        days = sorted({m.date().isoformat() for m in moments})
        span = days[0] if len(days) == 1 else f"{days[0]} to {days[-1]}"
        outcomes = []
        for person in sorted(people):
            others = set().union(*(group["holdings"][q] for q in people if q != person))
            disputed = set().union(*(_passage(snapshot, h) for h in others))
            outcomes.append(
                _evaluate(
                    snapshot,
                    baseline,
                    f"holder:{person}",
                    f"{who(person)} held it then",
                    {"assertions": {k: "disputed" for k in sorted(disputed)}},
                )
            )
        outcomes.append(inconclusive)
        sources = "; ".join(
            f"{who(person)} per {', '.join(sorted({doc(h) for h in group['holdings'][person]}))}"
            for person in sorted(people)
        )
        evidence = set().union(*group["holdings"].values())
        tasks.append(
            _task(
                key=f"t-{E.short_hash('attribution', identifier, *sorted(people), length=12)}",
                kind="attribution",
                title=f"Who used {identifier_value(identifier)} on {span}?",
                question=(
                    f"{len(group['events'])} call(s) on {span} are attributed to more than one "
                    f"person: {sources}. Inspect the subscriber assignment covering those dates."
                ),
                evidence=evidence,
                outcomes=outcomes,
                baseline=baseline,
                snapshot=snapshot,
                targets=(identifier,),
            )
        )

    # 2. Identity candidates that an explanation currently leans on.
    for candidate in sorted(baseline.candidates.values(), key=lambda c: c.key):
        edge = E.edge_key(E.SAME_AS, candidate.a, candidate.b)
        if not candidate.provisional or edge not in used:
            continue
        basis = {s.holding_a for s in candidate.shared if s.overlapping} | {
            s.holding_b for s in candidate.shared if s.overlapping
        }
        if not basis:
            basis = set(sorted(persons[candidate.a].mentions)[:2]) | set(
                sorted(persons[candidate.b].mentions)[:2]
            )
        grounds = "same name" if candidate.name_match else "different names"
        if any(s.overlapping for s in candidate.shared):
            grounds += ", a number both held at the same time"
        elif candidate.shared:
            grounds += ", a number each held at different times"
        outcomes = [
            _evaluate(
                snapshot,
                baseline,
                "accept",
                "Same person",
                {"identity": {candidate.key: "accepted"}},
            ),
            _evaluate(
                snapshot,
                baseline,
                "reject",
                "Different people",
                {"identity": {candidate.key: "rejected"}},
            ),
            inconclusive,
        ]
        tasks.append(
            _task(
                key=f"t-{E.short_hash('identity', candidate.key, length=12)}",
                kind="identity",
                title=f"Is {who(candidate.a)} the same person as {who(candidate.b)}?",
                question=f"Proposed on {grounds}. No one has reviewed it.",
                evidence=basis,
                outcomes=outcomes,
                baseline=baseline,
                snapshot=snapshot,
                targets=(candidate.key,),
            )
        )

    # 3. Proposed copies, grouped by the pair of documents involved.
    pairs: dict[tuple[str, str], list[E.LineageLink]] = defaultdict(list)
    for link in snapshot.links:
        if link.status != "proposed" or link.derivative not in used_atoms:
            continue
        if snapshot.groupings.get(link.key):
            continue
        pairs[(by_key[link.derivative].artifact, by_key[link.origin].artifact)].append(link)
    for (derivative, origin), links in sorted(pairs.items()):
        outcomes = [
            _evaluate(snapshot, baseline, "copy", "It repeats the origin", {}),
            _evaluate(
                snapshot,
                baseline,
                "independent",
                "It is an independent source",
                {"groupings": {link.key: "rejected" for link in links}},
            ),
        ]
        basis = links[0].basis.replace("_", " ")
        tasks.append(
            _task(
                key=f"t-{E.short_hash('lineage', derivative, origin, length=12)}",
                kind="lineage",
                title=f"Does {artifact_names.get(derivative, 'a document')} only repeat "
                f"{artifact_names.get(origin, 'another')}?",
                question=(
                    f"Grouped as one origin ({basis}) for {len(links)} statement(s), so it is "
                    "not counted as corroboration. Compare the two side by side."
                ),
                evidence={link.derivative for link in links} | {link.origin for link in links},
                outcomes=outcomes,
                baseline=baseline,
                snapshot=snapshot,
                targets=tuple(sorted(link.key for link in links)),
            )
        )

    # 4. A supported finding that one source family carries on its own.
    members: dict[str, set[str]] = defaultdict(set)
    for key, family in baseline.families.items():
        if key in baseline.active:
            members[family].add(key)
    critical: dict[str, list[str]] = defaultdict(list)
    for finding in baseline.findings.values():
        if finding.status != E.SUPPORTED:
            continue
        candidates = {
            baseline.families[atom]
            for edge in E.relevant_edges(baseline, finding)
            for derivation in edge.derivations
            for atom in derivation
            if atom in baseline.families
        }
        for family in sorted(candidates):
            status = E.finding_status(
                E.restrict(baseline, members[family]),
                finding,
                baseline.scenario.max_hops,
                baseline.anchors,
            )
            if status == E.UNSUPPORTED:
                critical[family].append(finding.key)
    origin_of = {
        family: by_key[baseline.roots[key]].artifact for key, family in baseline.families.items()
    }
    for family, finding_keys in sorted(critical.items()):
        if not finding_keys:
            continue
        sample = sorted(members[family])
        # Named after the original the family traces to, never an arbitrary member.
        name = artifact_names.get(origin_of.get(family, ""), family)
        outcomes = [
            _evaluate(snapshot, baseline, "confirmed", "The record checks out", {}),
            _evaluate(
                snapshot,
                baseline,
                "unreliable",
                "The record is unreliable",
                {"exclude_families": [family]},
            ),
        ]
        noun = "finding rests" if len(finding_keys) == 1 else "findings rest"
        tasks.append(
            _task(
                key=f"t-{E.short_hash('critical', family, length=12)}",
                kind="critical_source",
                title=f"Check {name}: {len(finding_keys)} {noun} on it alone",
                question=(
                    "Every explanation of these findings needs this source. Confirm the rows "
                    "the connections use against the original."
                ),
                evidence=set(sample[:6]),
                outcomes=outcomes,
                baseline=baseline,
                snapshot=snapshot,
                targets=(family,),
            )
        )

    tasks.sort(key=Task.priority)
    return tasks[:limit]
