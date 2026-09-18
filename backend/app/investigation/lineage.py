"""Which statements repeat which: source lineage across the documents in scope.

Consumed by investigation.service and investigation.package.

Three kinds of link, each with its own standing:

    declared_reference  the derivative names its source ("Source reference: GD
                        23/2026"). Confirmed: the document says so itself.
    near_verbatim       the same proposition in nearly the same words. Proposed:
                        copying is likely, and a reviewer can reject it.
    same_event          one call or transfer exported twice, in two record sets.
                        Proposed: two exports of one switch record are one
                        observation, not two.

A link needs the same proposition as well as the textual evidence. Shared
boilerplate therefore cannot group two documents on its own, and two witnesses
who independently say the same thing in different words stay two origins.
"""

from __future__ import annotations

import re
from collections import defaultdict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta

from rapidfuzz import fuzz

from app.investigation.engine import (
    CLAIM,
    CONTACT,
    HOLDS,
    LINK,
    TRANSFER,
    Assertion,
    LineageLink,
    short_hash,
)
from app.investigation.normalize import name_of

NEAR_VERBATIM_MIN_RATIO = 85.0
SAME_EVENT_MAX_SKEW = timedelta(seconds=120)

DECLARED = "declared_reference"
NEAR_VERBATIM = "near_verbatim"
SAME_EVENT = "same_event"


@dataclass(frozen=True, slots=True)
class ArtifactInfo:
    sha256: str
    case: str
    filename: str
    kind: str
    reference: str | None = None
    source_reference: str | None = None
    document_date: datetime | None = None


def _proposition(a: Assertion) -> tuple | None:
    """What a claim asserts, stripped of wording and of which file says it."""
    day = a.start.date().isoformat() if a.start else None
    if a.predicate == HOLDS:
        return (HOLDS, name_of(a.subject), a.object, a.polarity, day)
    if a.predicate == LINK and a.object is not None:
        return (LINK, *sorted((name_of(a.subject), name_of(a.object))), a.polarity, day)
    return None


def _wording(text: str) -> str:
    return " ".join(re.sub(r"[^\w\s]", " ", text.casefold()).split())


def _order(info: ArtifactInfo) -> tuple:
    """Which of two documents came first: its stated date, then its name."""
    stamp = info.document_date.isoformat() if info.document_date else "9999"
    return (stamp, info.filename, info.sha256)


def _link(
    derivative: Assertion,
    origin: Assertion,
    basis: str,
    status: str,
    score: float | None,
    note: str,
) -> LineageLink:
    return LineageLink(
        key=f"ll-{short_hash(derivative.key, origin.key, basis)}",
        derivative=derivative.key,
        origin=origin.key,
        basis=basis,
        status=status,
        score=score,
        note=note,
    )


def detect(
    assertions: Iterable[Assertion], artifacts: Mapping[tuple[str, str], ArtifactInfo]
) -> list[LineageLink]:
    """Every lineage link among the given assertions, deterministically ordered.

    ``artifacts`` is keyed by (case, sha256): the same bytes filed in two cases
    are one original, and share a family without needing a link.
    """
    items = sorted(assertions, key=lambda a: a.key)
    found: dict[tuple[str, str], LineageLink] = {}

    def keep(link: LineageLink) -> None:
        # One origin per derivative; a declared source outranks a resemblance.
        current = found.get((link.derivative, link.origin))
        rank = {DECLARED: 0, NEAR_VERBATIM: 1, SAME_EVENT: 2}
        if current is None or rank[link.basis] < rank[current.basis]:
            found[(link.derivative, link.origin)] = link

    claims: dict[tuple, list[Assertion]] = defaultdict(list)
    for a in items:
        if a.kind == CLAIM:
            proposition = _proposition(a)
            if proposition is not None:
                claims[proposition].append(a)

    for group in claims.values():
        for left_index, left in enumerate(group):
            for right in group[left_index + 1 :]:
                if left.artifact == right.artifact:
                    continue
                info_l = artifacts.get((left.case, left.artifact))
                info_r = artifacts.get((right.case, right.artifact))
                if info_l is None or info_r is None:
                    continue

                declared = None
                if info_l.source_reference and info_l.source_reference == info_r.reference:
                    declared = (left, right, info_l)
                elif info_r.source_reference and info_r.source_reference == info_l.reference:
                    declared = (right, left, info_r)
                if declared is not None:
                    derivative, origin, info = declared
                    keep(
                        _link(
                            derivative,
                            origin,
                            DECLARED,
                            "confirmed",
                            None,
                            f"{info.filename} cites {info.source_reference}",
                        )
                    )
                    continue

                ratio = fuzz.ratio(_wording(left.text), _wording(right.text))
                if ratio >= NEAR_VERBATIM_MIN_RATIO:
                    later_left = _order(info_l) > _order(info_r)
                    derivative, origin = (left, right) if later_left else (right, left)
                    keep(
                        _link(
                            derivative,
                            origin,
                            NEAR_VERBATIM,
                            "proposed",
                            round(ratio / 100, 3),
                            f"Same statement in nearly the same words ({ratio:.0f}% alike)",
                        )
                    )

    events: dict[tuple, list[Assertion]] = defaultdict(list)
    for a in items:
        if a.predicate in (CONTACT, TRANSFER) and a.start is not None:
            events[(a.predicate, a.subject, a.object)].append(a)
    for group in events.values():
        group.sort(key=lambda a: (a.start, a.key))
        for left_index, left in enumerate(group):
            for right in group[left_index + 1 :]:
                if right.start - left.start > SAME_EVENT_MAX_SKEW:
                    break
                if left.artifact == right.artifact:
                    continue
                if (
                    left.amount is not None
                    and right.amount is not None
                    and left.amount != right.amount
                ):
                    continue
                # Neither export is more original than the other; which one is
                # named the origin is arbitrary but stable (the lower artifact
                # key). What matters is that both land in one family.
                derivative, origin = (
                    (right, left) if left.artifact < right.artifact else (left, right)
                )
                keep(
                    _link(
                        derivative,
                        origin,
                        SAME_EVENT,
                        "proposed",
                        None,
                        "The same event appears in two record exports",
                    )
                )

    # A derivative keeps one origin: its strongest link, then the earliest key.
    best: dict[str, LineageLink] = {}
    rank = {DECLARED: 0, NEAR_VERBATIM: 1, SAME_EVENT: 2}
    for link in sorted(found.values(), key=lambda item: (rank[item.basis], item.key)):
        best.setdefault(link.derivative, link)
    return sorted(best.values(), key=lambda item: item.key)
