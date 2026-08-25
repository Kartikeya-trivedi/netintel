"""Entity recognition: spaCy statistical NER plus domain rules.

Phase 2 (PLAN.md section 5.2). Consumed by services.ingest.pipeline.

The statistical model handles PERSON / ORG / GPE / LOC. Everything investigation
specific -- phone numbers, bank accounts, IFSC codes, vehicle plates, FIR numbers,
quoted aliases -- comes from deterministic patterns, because recall on those must
be exact rather than probabilistic.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from app.config import get_settings

# Domain patterns. Tuned for Indian investigative documents.
PATTERNS: dict[str, re.Pattern[str]] = {
    "PHONE": re.compile(r"(?:\+91[\-\s]?)?[6-9]\d{9}\b"),
    "BANK_ACCOUNT": re.compile(r"\b\d{11,18}\b"),
    "IFSC": re.compile(r"\b[A-Z]{4}0[A-Z0-9]{6}\b"),
    "VEHICLE": re.compile(r"\b[A-Z]{2}[\s\-]?\d{1,2}[\s\-]?[A-Z]{1,3}[\s\-]?\d{4}\b"),
    "FIR": re.compile(r"\bFIR\s*(?:No\.?|Number)?\s*[:\-]?\s*\d+/\d{2,4}\b", re.IGNORECASE),
    "ALIAS": re.compile(
        r"(?:alias|aka|a\.k\.a\.)\s+[\"']?([A-Z][\w\s]{1,30}?)[\"']?"
        r"(?=[,.;]|\s+(?:and|who|was))",
        re.IGNORECASE,
    ),
}

DRUG_LEXICON = {
    "heroin", "cocaine", "charas", "ganja", "opium", "mephedrone", "brown sugar",
    "methamphetamine", "hashish", "contraband",
}
WEAPON_LEXICON = {
    "pistol", "revolver", "rifle", "ak-47", "firearm", "ammunition", "cartridges",
    "country-made pistol",
}

SPACY_LABEL_MAP = {
    "PERSON": "PERSON",
    "ORG": "ORG",
    "GPE": "LOCATION",
    "LOC": "LOCATION",
    "FAC": "LOCATION",
}


@dataclass(frozen=True)
class ExtractedEntity:
    text: str
    entity_type: str
    start: int
    end: int


@lru_cache
def _load_nlp() -> Any:
    """Load spaCy lazily so importing this module never costs model load time.

    Returns None when the model is unavailable, letting rule-based extraction
    still run rather than failing the whole ingest.
    """
    try:
        import spacy

        return spacy.load(get_settings().spacy_model)
    except Exception:  # model not downloaded, or spaCy missing
        return None


def extract_entities(text: str) -> list[ExtractedEntity]:
    """Return all entity spans found in text, de-overlapped.

    TODO(Phase 2): implement fully.
      1. run _load_nlp() over text, map labels via SPACY_LABEL_MAP
      2. run every regex in PATTERNS
      3. scan DRUG_LEXICON / WEAPON_LEXICON for DRUG / WEAPON spans
      4. drop overlapping spans, preferring the longer / rule-based match
    """
    raise NotImplementedError("Phase 2: see PLAN.md section 5.2")
