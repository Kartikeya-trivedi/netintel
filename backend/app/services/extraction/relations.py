"""Relationship extraction: co-occurrence baseline plus verb-cue typing.

Consumed by services.ingest.pipeline.

Every relation carries the sentence that produced it. An investigator has to be
able to ask why the system drew an edge and get the source text back, so an
edge without evidence is not something this module is allowed to emit.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from itertools import combinations

from app.services.extraction.ner import ExtractedEntity, _load_nlp

# Verb cues that upgrade a bare co-occurrence into a typed relationship.
RELATION_CUES: dict[str, tuple[str, ...]] = {
    "TRANSACTED_WITH": (
        "paid", "transferred", "remitted", "sent money", "deposited", "wired",
        "payment of", "funds moved to", "credited",
    ),
    "CALLED": ("called", "contacted", "phoned", "spoke to", "messaged", "in touch with"),
    "MEMBER_OF": (
        "member of", "belongs to", "affiliated with", "works for", "runs",
        "operates under", "part of",
    ),
    "LOCATED_AT": (
        "seen at", "spotted at", "resides at", "operates from", "arrested at",
        "intercepted at", "near", "recovered from",
    ),
    "OWNS": ("owns", "registered to", "in the name of", "held by", "used by"),
}

DEFAULT_REL_TYPE = "ASSOCIATES_WITH"

# When no verb cue fires, the pair of entity types still implies a relationship.
TYPE_PAIR_DEFAULTS: dict[frozenset[str], str] = {
    frozenset({"PERSON", "PHONE"}): "OWNS",
    frozenset({"PERSON", "BANK_ACCOUNT"}): "OWNS",
    frozenset({"PERSON", "VEHICLE"}): "OWNS",
    frozenset({"PERSON", "LOCATION"}): "LOCATED_AT",
    frozenset({"PERSON", "ORG"}): "MEMBER_OF",
}

# Types that should be the target of their relationship regardless of which one
# appears first in the sentence: a person owns an account, never the reverse.
_OBJECT_TYPES = frozenset({"PHONE", "BANK_ACCOUNT", "VEHICLE", "LOCATION", "ORG", "DRUG", "WEAPON"})

# Identifiers belong to whoever the sentence attaches them to, whatever verb is
# nearby. "Kulkarni was contacted on 98765..." is an ownership fact about the
# number, not a call between Kulkarni and his own phone.
_IDENTIFIER_TYPES = frozenset({"PHONE", "BANK_ACCOUNT", "VEHICLE"})

# A verb cue only types an edge when the entity types can actually support it.
# Without this, one "near" anywhere in a sentence turns every pair in that
# sentence into LOCATED_AT, including person-to-person pairs.
REL_TYPE_CONSTRAINTS: dict[str, frozenset[str]] = {
    "TRANSACTED_WITH": frozenset({"PERSON", "ORG", "BANK_ACCOUNT"}),
    "CALLED": frozenset({"PERSON", "PHONE"}),
    "MEMBER_OF": frozenset({"PERSON", "ORG"}),
    "LOCATED_AT": frozenset({"PERSON", "ORG", "LOCATION", "VEHICLE"}),
    "OWNS": frozenset({"PERSON", "ORG", "PHONE", "BANK_ACCOUNT", "VEHICLE"}),
}

# Relationships that additionally require a specific type on one endpoint.
REL_TYPE_REQUIRES: dict[str, str] = {
    "LOCATED_AT": "LOCATION",
    "MEMBER_OF": "ORG",
}

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")


@dataclass
class ExtractedRelation:
    source: ExtractedEntity
    target: ExtractedEntity
    rel_type: str
    weight: float = 1.0
    evidence: list[dict] = field(default_factory=list)


def _clip_to_lines(start: int, text: str) -> list[tuple[int, int, str]]:
    """Break a span at newlines, returning absolute (start, end, text) pieces."""
    pieces: list[tuple[int, int, str]] = []
    offset = 0
    for line in text.splitlines(keepends=True):
        stripped = line.strip()
        if stripped:
            lead = len(line) - len(line.lstrip())
            begin = start + offset + lead
            pieces.append((begin, begin + len(stripped), stripped))
        offset += len(line)
    return pieces


def _sentences(text: str) -> list[tuple[int, int, str]]:
    """Split into (start, end, sentence_text), never crossing a line break.

    Report lines are one statement each, but the segmenter breaks on "Rs." and
    then runs the remainder of the line into the next one. That silently paired
    people from unrelated statements, inventing edges the reports never claimed.
    A relation must not be inferred across a line boundary.
    """
    nlp = _load_nlp()
    if nlp is not None:
        doc = nlp(text)
        spans = [
            piece
            for sent in doc.sents
            for piece in _clip_to_lines(sent.start_char, sent.text)
        ]
        if spans:
            return spans

    spans = []
    cursor = 0
    for chunk in _SENTENCE_SPLIT.split(text):
        begin = text.find(chunk, cursor)
        if begin == -1:
            continue
        spans.extend(_clip_to_lines(begin, chunk))
        cursor = begin + len(chunk)
    return spans


def _find_cue(segment: str) -> str | None:
    """Return the relationship type implied by a cue phrase in segment, if any."""
    lowered = segment.casefold()
    best: tuple[int, str] | None = None
    for rel_type, cues in RELATION_CUES.items():
        for cue in cues:
            position = lowered.find(cue)
            if position != -1 and (best is None or position < best[0]):
                best = (position, rel_type)
    return best[1] if best else None


def _is_compatible(rel_type: str, types: frozenset[str]) -> bool:
    """Whether a relationship type can hold between this pair of entity types."""
    allowed = REL_TYPE_CONSTRAINTS.get(rel_type)
    if allowed is not None and not types <= allowed:
        return False
    required = REL_TYPE_REQUIRES.get(rel_type)
    return required is None or required in types


def _classify(
    text: str, left: ExtractedEntity, right: ExtractedEntity, sentence: str
) -> tuple[ExtractedEntity, ExtractedEntity, str]:
    """Decide the relationship type and which entity is the source."""
    types = frozenset({left.entity_type, right.entity_type})

    # An identifier paired with its holder is ownership, full stop.
    if len(types) == 2 and types & _IDENTIFIER_TYPES and types & {"PERSON", "ORG"}:
        rel_type = "OWNS"
    else:
        # A cue between the two mentions is far stronger evidence than one loose
        # elsewhere in the sentence, so it is tried first.
        gap = text[left.end : right.start]
        rel_type = next(
            (
                candidate
                for candidate in (_find_cue(gap), _find_cue(sentence))
                if candidate is not None and _is_compatible(candidate, types)
            ),
            None,
        )
        if rel_type is None:
            rel_type = TYPE_PAIR_DEFAULTS.get(types, DEFAULT_REL_TYPE)
            if not _is_compatible(rel_type, types):
                rel_type = DEFAULT_REL_TYPE

    source, target = left, right
    if left.entity_type in _OBJECT_TYPES and right.entity_type not in _OBJECT_TYPES:
        source, target = right, left

    return source, target, rel_type


def _snippet(sentence: str, limit: int = 240) -> str:
    collapsed = " ".join(sentence.split())
    return collapsed if len(collapsed) <= limit else collapsed[: limit - 1] + "…"


def extract_relations(
    text: str, entities: list[ExtractedEntity], doc_id: int
) -> list[ExtractedRelation]:
    """Derive typed relations between entities co-occurring in a sentence.

    Weight is the number of distinct sentences supporting the link, which makes
    a pair named together in eight reports outrank one named together once.
    """
    if len(entities) < 2:
        return []

    sentences = _sentences(text)
    buckets: dict[int, list[ExtractedEntity]] = defaultdict(list)
    for entity in entities:
        for index, (start, end, _) in enumerate(sentences):
            if entity.start >= start and entity.end <= end:
                buckets[index].append(entity)
                break

    aggregated: dict[tuple[str, str, str], ExtractedRelation] = {}

    for index, present in buckets.items():
        sentence = sentences[index][2]
        ordered = sorted(present, key=lambda e: e.start)
        for left, right in combinations(ordered, 2):
            if left.text.casefold() == right.text.casefold():
                continue

            source, target, rel_type = _classify(text, left, right, sentence)
            key = (source.text.casefold(), target.text.casefold(), rel_type)

            relation = aggregated.get(key)
            if relation is None:
                aggregated[key] = ExtractedRelation(
                    source=source,
                    target=target,
                    rel_type=rel_type,
                    weight=1.0,
                    evidence=[{"doc_id": doc_id, "snippet": _snippet(sentence)}],
                )
            else:
                relation.weight += 1.0
                if len(relation.evidence) < 5:
                    relation.evidence.append({"doc_id": doc_id, "snippet": _snippet(sentence)})

    return list(aggregated.values())
