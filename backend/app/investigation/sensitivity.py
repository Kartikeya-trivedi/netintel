"""What a finding needs: withdrawal search and the assumptions it rests on.

Consumed by investigation.service and investigation.verification.

The withdrawal search is exhaustive within stated limits and says what those
limits were. A reported set is minimal: no subset of it breaks the finding.
"No set of size one or two broke this" is a statement about the families that
were searched, never about sources nobody has, and the survival of a finding
across scenarios is a sensitivity statistic, not a probability that it is true.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from itertools import combinations

from app.investigation import engine as E

DEFAULT_MAX_SET_SIZE = 2
MAX_UNITS = 24


@dataclass(frozen=True, slots=True)
class WithdrawalSet:
    families: tuple[str, ...]
    status: str  # the finding's status with these families withdrawn


@dataclass(frozen=True, slots=True)
class Alternative:
    kind: str  # identity | attribution
    subject: str  # candidate key, or the holding assertion assumed wrong
    status: str  # the finding's status if that assumption fails
    detail: dict


@dataclass(frozen=True)
class SensitivityReport:
    finding: str
    status: str
    units: tuple[str, ...]
    units_total: int
    max_set_size: int
    exhaustive: bool
    evaluations: int
    breaking: tuple[WithdrawalSet, ...]
    downgrading: tuple[WithdrawalSet, ...]
    critical: tuple[str, ...]
    alternatives: tuple[Alternative, ...]


def _units(projection: E.Projection, edges: list[E.Edge]) -> Counter:
    """Families supporting any edge that could carry a path, weighted by use."""
    weight: Counter = Counter()
    for edge in edges:
        for derivation in edge.derivations:
            for atom in derivation:
                family = projection.families.get(atom)
                if family is not None:
                    weight[family] += 1
    return weight


def _passage(snapshot: E.Snapshot, key: str) -> set[str]:
    """Every assertion from the same evidence item as ``key``.

    Doubting who used a number in a sentence doubts the rest of that sentence
    too: the tip's "Sameer was in touch with Pappu" rests on the same misread
    number as its "using mobile ..." clause.
    """
    by_key = snapshot.assertion_map()
    target = by_key[key]
    return {
        a.key
        for a in snapshot.assertions
        if a.artifact == target.artifact and a.item == target.item
    }


def analyse(
    snapshot: E.Snapshot,
    projection: E.Projection,
    finding: E.Finding,
    *,
    max_set_size: int = DEFAULT_MAX_SET_SIZE,
    max_units: int = MAX_UNITS,
) -> SensitivityReport:
    anchors = projection.anchors
    limit = projection.scenario.max_hops
    relevant = E.relevant_edges(projection, finding)
    weight = _units(projection, relevant)
    ranked = sorted(weight, key=lambda family: (-weight[family], family))
    searched = ranked[:max_units]

    members: dict[str, set[str]] = defaultdict(set)
    for key, family in projection.families.items():
        if key in projection.active:
            members[family].add(key)

    breaking: list[WithdrawalSet] = []
    downgrading: list[WithdrawalSet] = []
    evaluations = 0
    for size in range(1, max_set_size + 1):
        for combo in combinations(searched, size):
            chosen = set(combo)
            if any(set(found.families) <= chosen for found in breaking):
                continue
            excluded = set().union(*(members[f] for f in combo))
            status = E.finding_status(E.restrict(projection, excluded), finding, limit, anchors)
            evaluations += 1
            if status == E.UNSUPPORTED:
                breaking.append(WithdrawalSet(tuple(combo), status))
            elif (
                status == E.LEAD
                and finding.status == E.SUPPORTED
                and not any(set(found.families) <= chosen for found in downgrading)
            ):
                downgrading.append(WithdrawalSet(tuple(combo), status))

    alternatives: list[Alternative] = []
    subjects = sorted(anchors)
    relevant_keys = {edge.key for edge in relevant}
    for candidate in sorted(projection.candidates.values(), key=lambda c: c.key):
        if not candidate.in_effect:
            continue
        if E.edge_key(E.SAME_AS, candidate.a, candidate.b) not in relevant_keys:
            continue
        scenario = _with(projection.scenario, identity={candidate.key: "rejected"})
        outcome = E.derive(snapshot, scenario, subjects=subjects).findings.get(finding.key)
        alternatives.append(
            Alternative(
                kind="identity",
                subject=candidate.key,
                status=outcome.status if outcome else E.UNSUPPORTED,
                detail={"if": "rejected", "provisional": candidate.provisional},
            )
        )

    relevant_atoms = {atom for edge in relevant for d in edge.derivations for atom in d}
    seen: set[str] = set()
    for conflict in projection.conflicts:
        if conflict.event not in relevant_atoms:
            continue
        for _, holding in conflict.holders:
            if holding in seen:
                continue
            seen.add(holding)
            disputed = {key: "disputed" for key in _passage(snapshot, holding)}
            scenario = _with(projection.scenario, assertions=disputed)
            outcome = E.derive(snapshot, scenario, subjects=subjects).findings.get(finding.key)
            alternatives.append(
                Alternative(
                    kind="attribution",
                    subject=holding,
                    status=outcome.status if outcome else E.UNSUPPORTED,
                    detail={"identifier": conflict.identifier, "if": "disputed"},
                )
            )

    return SensitivityReport(
        finding=finding.key,
        status=finding.status,
        units=tuple(searched),
        units_total=len(ranked),
        max_set_size=max_set_size,
        exhaustive=len(ranked) <= max_units,
        evaluations=evaluations,
        breaking=tuple(breaking),
        downgrading=tuple(downgrading),
        critical=tuple(found.families[0] for found in breaking if len(found.families) == 1),
        alternatives=tuple(alternatives),
    )


def _with(base: E.Scenario, **overrides) -> E.Scenario:
    """The scenario a projection was computed under, plus more assumptions."""
    data = base.to_dict()
    for field_name, extra in overrides.items():
        current = data[field_name]
        if isinstance(current, dict):
            data[field_name] = {**current, **extra}
        elif isinstance(current, list):
            data[field_name] = sorted({*current, *extra})
        else:
            data[field_name] = extra
    return E.Scenario.from_dict(data)
