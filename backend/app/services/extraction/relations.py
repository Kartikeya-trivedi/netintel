"""Relationship extraction: co-occurrence baseline plus verb patterns.

Phase 2 (PLAN.md section 5.3). Consumed by services.ingest.pipeline.

Every relation carries the sentence that produced it, so the UI can always show
an investigator why the system drew a given edge.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.services.extraction.ner import ExtractedEntity

# Verb cues that upgrade a bare co-occurrence into a typed relationship.
RELATION_CUES: dict[str, tuple[str, ...]] = {
    "TRANSACTED_WITH": ("paid", "transferred", "remitted", "sent money", "deposited", "wired"),
    "CALLED": ("called", "contacted", "phoned", "spoke to", "messaged"),
    "MEMBER_OF": ("member of", "belongs to", "affiliated with", "works for", "runs"),
    "LOCATED_AT": ("seen at", "spotted at", "resides at", "operates from", "arrested at"),
    "OWNS": ("owns", "registered to", "in the name of"),
}

DEFAULT_REL_TYPE = "ASSOCIATES_WITH"


@dataclass
class ExtractedRelation:
    source: ExtractedEntity
    target: ExtractedEntity
    rel_type: str
    weight: float = 1.0
    evidence: list[dict] = field(default_factory=list)


def extract_relations(
    text: str, entities: list[ExtractedEntity], doc_id: int
) -> list[ExtractedRelation]:
    """Derive typed relations between entities co-occurring in the same sentence.

    TODO(Phase 2): implement fully.
      1. segment text into sentences, bucket entity spans per sentence
      2. for each entity pair in a sentence, scan for a RELATION_CUES phrase
         between them -> typed relation; otherwise DEFAULT_REL_TYPE
      3. accumulate weight across sentences, append {doc_id, snippet} evidence
    """
    raise NotImplementedError("Phase 2: see PLAN.md section 5.3")
