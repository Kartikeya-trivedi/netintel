"""Entity resolution: collapse aliases and surface variants into one entity.

Consumed by services.ingest.pipeline.

Two different matching regimes, because the cost of a mistake differs. Names
tolerate fuzzy matching -- "Kulkarni, Ramesh" and "Ramesh Kulkarni" are one
person. Identifiers do not: a one-digit difference in an account number is a
different account, never a typo, so those match exactly or not at all.
"""

from __future__ import annotations

import re
from collections import defaultdict

from rapidfuzz import fuzz

HONORIFICS = re.compile(r"^(shri|smt|mr|mrs|ms|dr|sh|md|mohd)\.?\s+", re.IGNORECASE)

# rapidfuzz token_sort_ratio at or above this merges two names of the same type.
# Deliberately strict. At 90, "Kiran Ansari" and "Imran Ansari" score 91.7 and
# collapse into one node, silently fusing two suspects and handing whoever
# survives the merge the combined centrality of both. Structural equality below
# does the real work; this threshold only forgives typos.
FUZZY_MERGE_THRESHOLD = 95

# Types matched exactly after normalisation rather than fuzzily.
EXACT_MATCH_TYPES = frozenset({"PHONE", "BANK_ACCOUNT", "IFSC", "VEHICLE"})


def normalize_name(name: str) -> str:
    """Casefold, strip honorifics, and collapse whitespace."""
    cleaned = HONORIFICS.sub("", name.strip())
    cleaned = cleaned.strip(".,;:\"'")
    return re.sub(r"\s+", " ", cleaned).casefold()


def normalize_identifier(value: str) -> str:
    """Strip separators from phone numbers, accounts, and plates."""
    stripped = re.sub(r"[\s\-+()]", "", value).upper()
    # Indian numbers appear with and without the country code; unify on the
    # 10-digit national form so both spellings land on the same entity.
    if len(stripped) == 12 and stripped.startswith("91"):
        return stripped[2:]
    return stripped


def _name_tokens(name: str) -> frozenset[str]:
    """Normalised word set, with punctuation stripped from each token."""
    return frozenset(
        token for token in (t.strip(".,;:\"'") for t in normalize_name(name).split()) if token
    )


def names_match(left: str, right: str) -> bool:
    """Whether two name surfaces denote the same person.

    Token-set equality is the primary test, because the real-world variation is
    word order and punctuation -- "Kulkarni, Ramesh" against "Ramesh Kulkarni".
    Fuzzy similarity is only a fallback for genuine typos, and is held high
    enough that two different people who share a surname stay separate.
    """
    left_norm, right_norm = normalize_name(left), normalize_name(right)
    if not left_norm or not right_norm:
        return False
    if left_norm == right_norm:
        return True
    if _name_tokens(left) == _name_tokens(right):
        return True
    return fuzz.token_sort_ratio(left_norm, right_norm) >= FUZZY_MERGE_THRESHOLD


def _canonical_form(surfaces: list[str]) -> str:
    """Pick the display name: most frequent, then natural word order, then longest.

    Frequency first means the form investigators actually use wins over a one-off
    spelling. The comma test breaks ties toward "Ramesh Kulkarni" rather than the
    index-card inversion "Kulkarni, Ramesh", which reads badly as a node label.
    """
    counts: dict[str, int] = defaultdict(int)
    for surface in surfaces:
        counts[surface.strip()] += 1
    return max(counts, key=lambda s: (counts[s], "," not in s, len(s), s))


def resolve(candidates: list[dict]) -> list[dict]:
    """Merge candidate entity dicts into canonical entities.

    Each candidate needs at least ``text`` and ``entity_type``; any other keys
    (span offsets, doc id) ride along in ``members`` so the caller can still
    build Mention rows pointing at the original spans.

    Returns dicts of ``canonical_name``, ``entity_type``, ``aliases``,
    ``normalized``, and ``members``.
    """
    by_type: dict[str, list[dict]] = defaultdict(list)
    for candidate in candidates:
        if candidate.get("text") and candidate.get("entity_type"):
            by_type[candidate["entity_type"]].append(candidate)

    resolved: list[dict] = []

    for entity_type, group in by_type.items():
        if entity_type in EXACT_MATCH_TYPES:
            buckets: dict[str, list[dict]] = defaultdict(list)
            for candidate in group:
                buckets[normalize_identifier(candidate["text"])].append(candidate)
            clusters = list(buckets.items())
        else:
            clusters = _fuzzy_cluster(group)

        for key, members in clusters:
            surfaces = [m["text"] for m in members]
            canonical = _canonical_form(surfaces)
            aliases = sorted({s.strip() for s in surfaces if s.strip() != canonical})
            resolved.append(
                {
                    "canonical_name": canonical,
                    "entity_type": entity_type,
                    "aliases": aliases,
                    "normalized": key,
                    "members": members,
                }
            )

    return resolved


def _fuzzy_cluster(group: list[dict]) -> list[tuple[str, list[dict]]]:
    """Greedy single-pass clustering on token-sorted similarity.

    Longest-first ordering means fuller names become cluster seeds, so short
    fragments attach to them rather than founding rival clusters.
    """
    ordered = sorted(group, key=lambda c: -len(c["text"]))
    seeds: list[str] = []
    clusters: dict[str, list[dict]] = defaultdict(list)

    for candidate in ordered:
        normalized = normalize_name(candidate["text"])
        if not normalized:
            continue

        match = next((seed for seed in seeds if names_match(normalized, seed)), None)
        if match is None:
            seeds.append(normalized)
            match = normalized
        clusters[match].append(candidate)

    return list(clusters.items())


def apply_alias_links(clusters: list[dict], links: list[tuple[str, str]]) -> list[dict]:
    """Fold alias clusters into the person clusters they belong to.

    Runs after resolve(). An explicit "X alias Y" statement in the source text
    is stronger evidence than any string-similarity score, so it overrides the
    fuzzy clustering rather than competing with it.
    """
    if not links:
        return clusters

    def find(surface: str) -> dict | None:
        target = normalize_name(surface)
        for cluster in clusters:
            names = [cluster["canonical_name"], *cluster["aliases"]]
            if any(normalize_name(n) == target for n in names):
                return cluster
        return None

    absorbed: list[int] = []

    for person_surface, alias_surface in links:
        person = find(person_surface)
        alias = find(alias_surface)
        if person is None or alias is None or person is alias:
            continue
        if person["entity_type"] != alias["entity_type"]:
            continue

        person["members"].extend(alias["members"])
        merged = {*person["aliases"], *alias["aliases"], alias["canonical_name"]}
        merged.discard(person["canonical_name"])
        person["aliases"] = sorted(merged)
        absorbed.append(id(alias))

    return [c for c in clusters if id(c) not in absorbed]
