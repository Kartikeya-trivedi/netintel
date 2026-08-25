"""Entity recognition: spaCy statistical NER plus deterministic domain rules.

Consumed by services.ingest.pipeline.

The statistical model handles PERSON / ORG / GPE / LOC. Everything investigation
specific -- phone numbers, bank accounts, vehicle plates, quoted aliases -- comes
from regex, because recall on an account number has to be exact rather than
probabilistic. Where the two disagree about the same span, the rule wins.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from app.config import get_settings

# Patterns tuned for Indian investigative documents.
PATTERNS: dict[str, re.Pattern[str]] = {
    "PHONE": re.compile(r"(?:\+91[\-\s]?)?[6-9]\d{9}\b"),
    "BANK_ACCOUNT": re.compile(r"\b\d{11,18}\b"),
    "IFSC": re.compile(r"\b[A-Z]{4}0[A-Z0-9]{6}\b"),
    "VEHICLE": re.compile(r"\b[A-Z]{2}[\s\-]?\d{1,2}[\s\-]?[A-Z]{1,3}[\s\-]?\d{4}\b"),
    "FIR": re.compile(r"\bFIR\s*(?:No\.?|Number)?\s*[:\-]?\s*\d+/\d{2,4}\b", re.IGNORECASE),
    # Quoted form first ("alias 'Raja'"), then bare capitalised words. The two
    # branches mean group 1 or group 2 carries the name, never both.
    "ALIAS": re.compile(
        r"(?:(?i:alias|aka|a\.k\.a\.))\s+"
        r"(?:[\"']([^\"']{1,40})[\"']|([A-Z][\w]*(?:\s+[A-Z][\w]*){0,2}))",
    ),
}

# Patterns that describe the document rather than a node in the network. They
# stay in PATTERNS for reuse, but never become graph entities.
NON_ENTITY_PATTERNS = frozenset({"IFSC", "FIR"})

# A quoted alias identifies a person, so it is emitted under that type and the
# resolver later folds it into the canonical individual.
ALIAS_ENTITY_TYPE = "PERSON"

DRUG_LEXICON = frozenset(
    {
        "heroin", "cocaine", "charas", "ganja", "opium", "mephedrone",
        "brown sugar", "methamphetamine", "hashish", "contraband",
    }
)
WEAPON_LEXICON = frozenset(
    {
        "pistol", "revolver", "rifle", "ak-47", "firearm", "ammunition",
        "cartridges", "country-made pistol",
    }
)

# A name directly after a locative preposition is a place, whatever the model
# says. Statistical NER reliably mistakes Indian place names ("Marol Naka",
# "Dharavi") for people, and this catches the common framing.
LOCATIVE_CUES = re.compile(
    r"\b(?:near|at|from|in|outside|inside|towards?|behind|opposite|via)\s+$",
    re.IGNORECASE,
)

SPACY_LABEL_MAP = {
    "PERSON": "PERSON",
    "ORG": "ORG",
    "GPE": "LOCATION",
    "LOC": "LOCATION",
    "FAC": "LOCATION",
}

# Currency markers and case-file boilerplate that the statistical model likes to
# tag as organisations. They are never nodes in a criminal network.
SURFACE_BLOCKLIST = frozenset(
    {
        "rs", "rs.", "inr", "rupees", "fir", "no", "no.", "police", "police station",
        "the", "cr", "pc", "ipc", "ndps",
    }
)

VALID_ENTITY_TYPES = frozenset(
    {"PERSON", "ORG", "LOCATION", "PHONE", "BANK_ACCOUNT", "VEHICLE", "WEAPON", "DRUG"}
)

# Higher wins when two extractors claim overlapping text.
_RULE_PRIORITY = 2
_MODEL_PRIORITY = 1


@dataclass(frozen=True)
class ExtractedEntity:
    text: str
    entity_type: str
    start: int
    end: int


@lru_cache
def _load_nlp() -> Any:
    """Load spaCy lazily, falling back to the small model, then to None.

    Returning None is a supported state: rule-based extraction still runs, so a
    missing model degrades entity coverage instead of failing the ingest.
    """
    try:
        import spacy
    except ImportError:
        return None

    for name in (get_settings().spacy_model, "en_core_web_sm"):
        try:
            return spacy.load(name)
        except Exception:
            continue
    return None


def _gazetteer_candidates(
    text: str, gazetteer: dict[str, str]
) -> list[tuple[int, int, str, str, int]]:
    """Match names the case already knows about.

    Once a report has established that "Bhai" is Salim More, later reports name
    him with no alias cue and no capitalised give-away, and the statistical
    model simply does not see him. Carrying known surfaces forward is how an
    analyst reads a case file too: you recognise the name because you met it in
    the last document.
    """
    found: list[tuple[int, int, str, str, int]] = []
    if not gazetteer:
        return found

    # Longest first, so "Salim More" wins over a bare "Salim".
    for surface in sorted(gazetteer, key=len, reverse=True):
        if len(surface) < 3:
            continue
        for match in re.finditer(rf"\b{re.escape(surface)}\b", text):
            found.append(
                (match.start(), match.end(), gazetteer[surface], match.group(0), _RULE_PRIORITY)
            )
    return found


def _rule_candidates(text: str) -> list[tuple[int, int, str, str, int]]:
    """(start, end, entity_type, surface, priority) from regex and lexicons."""
    found: list[tuple[int, int, str, str, int]] = []

    for label, pattern in PATTERNS.items():
        if label in NON_ENTITY_PATTERNS:
            continue
        for match in pattern.finditer(text):
            # ALIAS has two alternative capture groups; take whichever fired so
            # the cue word itself never becomes part of the entity.
            group = 0
            if label == "ALIAS":
                group = next(
                    (g for g in range(1, (match.lastindex or 0) + 1) if match.group(g)), 0
                )
            entity_type = ALIAS_ENTITY_TYPE if label == "ALIAS" else label
            start, _ = match.span(group)
            surface = (match.group(group) or "").strip()
            if surface:
                found.append((start, start + len(surface), entity_type, surface, _RULE_PRIORITY))

    # "Salim More alias Bhai" states that Salim More is a person, and states the
    # full extent of the name. The statistical model often clips such names at a
    # token that doubles as a common word ("More"), so the sentence structure is
    # the better authority here.
    for match in ALIAS_LINK.finditer(text):
        person = (match.group(1) or "").strip()
        if person:
            start = match.start(1)
            found.append((start, start + len(person), "PERSON", person, _RULE_PRIORITY))

    for lexicon, entity_type in ((DRUG_LEXICON, "DRUG"), (WEAPON_LEXICON, "WEAPON")):
        for term in lexicon:
            for match in re.finditer(rf"\b{re.escape(term)}\b", text, re.IGNORECASE):
                found.append(
                    (match.start(), match.end(), entity_type, match.group(0), _RULE_PRIORITY)
                )

    return found


def _model_candidates(text: str) -> list[tuple[int, int, str, str, int]]:
    """(start, end, entity_type, surface, priority) from the spaCy pipeline."""
    nlp = _load_nlp()
    if nlp is None:
        return []

    blocked = _metadata_regions(text)
    doc = nlp(text)
    found: list[tuple[int, int, str, str, int]] = []
    for ent in doc.ents:
        entity_type = SPACY_LABEL_MAP.get(ent.label_)
        if entity_type is None:
            continue
        surface = ent.text.strip()
        if not surface:
            continue
        start = ent.start_char
        end = start + len(surface)
        # "FIR No. 214/2026" is a case reference, not an organisation.
        if any(start < b_end and b_start < end for b_start, b_end in blocked):
            continue
        if entity_type == "PERSON" and LOCATIVE_CUES.search(text[max(0, start - 24):start]):
            entity_type = "LOCATION"
        found.append((start, end, entity_type, surface, _MODEL_PRIORITY))
    return found


def _metadata_regions(text: str) -> list[tuple[int, int]]:
    """Spans covered by document-reference patterns (FIR numbers, IFSC codes)."""
    regions: list[tuple[int, int]] = []
    for label in NON_ENTITY_PATTERNS:
        regions.extend(m.span() for m in PATTERNS[label].finditer(text))
    return regions


def _drop_overlaps(
    candidates: list[tuple[int, int, str, str, int]],
) -> list[tuple[int, int, str, str, int]]:
    """Keep the strongest claim on each stretch of text.

    Sorting by (priority desc, length desc) and greedily accepting means a rule
    match always beats a model guess on the same span, and a longer name beats
    the fragment inside it.
    """
    ordered = sorted(candidates, key=lambda c: (-c[4], -(c[1] - c[0]), c[0]))
    accepted: list[tuple[int, int, str, str, int]] = []
    for cand in ordered:
        start, end = cand[0], cand[1]
        if any(start < acc[1] and acc[0] < end for acc in accepted):
            continue
        accepted.append(cand)
    return sorted(accepted, key=lambda c: c[0])


def extract_entities(
    text: str, gazetteer: dict[str, str] | None = None
) -> list[ExtractedEntity]:
    """Return every entity span in text, de-overlapped and in document order.

    ``gazetteer`` maps a known surface form to its entity type, letting entities
    established by earlier documents in the same case be recognised here.
    """
    if not text:
        return []

    candidates = (
        _rule_candidates(text)
        + _gazetteer_candidates(text, gazetteer or {})
        + _model_candidates(text)
    )
    return [
        ExtractedEntity(text=surface, entity_type=entity_type, start=start, end=end)
        for start, end, entity_type, surface, _ in _drop_overlaps(candidates)
        if entity_type in VALID_ENTITY_TYPES and not _is_noise(surface)
    ]


# A span containing one of these has run past the name and swallowed sentence
# structure -- "Bhai remitted Rs" is not an organisation.
_SPAN_RUNON = re.compile(
    r"\b(?:remitted|transferred|paid|called|contacted|phoned|observed|placed|seen|"
    r"met|meeting|recovered|registered|used|shows?|company|surveillance|rs)\b",
    re.IGNORECASE,
)


def _is_noise(surface: str) -> bool:
    """Reject boilerplate, bare punctuation, and spans that overran the name."""
    cleaned = surface.strip().strip(".,;:\"'").casefold()
    leading_article = cleaned.removeprefix("the ").strip()
    return (
        len(cleaned) < 2
        or cleaned in SURFACE_BLOCKLIST
        or leading_article in SURFACE_BLOCKLIST
        or not any(ch.isalnum() for ch in cleaned)
        or bool(_SPAN_RUNON.search(cleaned))
    )


# "Vikram Rathore alias Bhai" — captures both halves so the resolver can fold
# the nickname into the person. Fuzzy name matching cannot do this on its own:
# "Bhai" and "Vikram Rathore" share no tokens, yet they are the same man, and
# in this domain the alias is often the only name a report uses.
ALIAS_LINK = re.compile(
    r"([A-Z][\w.]*(?:\s+[A-Z][\w.]*){0,3})\s+(?:(?i:alias|aka|a\.k\.a\.))\s+"
    r"(?:[\"']([^\"']{1,40})[\"']|([A-Z][\w]*(?:\s+[A-Z][\w]*){0,2}))",
)


def alias_links(text: str) -> list[tuple[str, str]]:
    """Return (person_surface, alias_surface) pairs stated in the text."""
    links = []
    for match in ALIAS_LINK.finditer(text):
        person = (match.group(1) or "").strip()
        alias = (match.group(2) or match.group(3) or "").strip()
        if person and alias and person.casefold() != alias.casefold():
            links.append((person, alias))
    return links
