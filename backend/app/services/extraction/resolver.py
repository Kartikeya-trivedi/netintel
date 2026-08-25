"""Entity resolution: collapse aliases and surface variants into one entity.

Phase 2 (PLAN.md section 5.4). Consumed by services.ingest.pipeline.
"""

from __future__ import annotations

import re

HONORIFICS = re.compile(
    r"^(shri|smt|mr|mrs|ms|dr|sh|md|mohd)\.?\s+", re.IGNORECASE
)

# rapidfuzz token_sort_ratio at or above this merges two names of the same type.
FUZZY_MERGE_THRESHOLD = 90

# Types matched exactly after normalisation rather than fuzzily -- a one-digit
# difference in an account number is a different account, not a typo.
EXACT_MATCH_TYPES = {"PHONE", "BANK_ACCOUNT", "IFSC", "VEHICLE"}


def normalize_name(name: str) -> str:
    """Casefold, strip honorifics, and collapse whitespace."""
    cleaned = HONORIFICS.sub("", name.strip())
    return re.sub(r"\s+", " ", cleaned).casefold()


def normalize_identifier(value: str) -> str:
    """Strip separators from phone numbers, accounts, and plates."""
    return re.sub(r"[\s\-+]", "", value).upper().removeprefix("91")


def resolve(candidates: list[dict]) -> list[dict]:
    """Merge candidate entity dicts into canonical entities with alias lists.

    TODO(Phase 2): implement fully.
      1. bucket candidates by entity_type
      2. EXACT_MATCH_TYPES -> group on normalize_identifier
      3. everything else -> rapidfuzz token_sort_ratio >= FUZZY_MERGE_THRESHOLD
      4. pick the longest / most frequent surface form as canonical_name,
         keep the rest in aliases
    """
    raise NotImplementedError("Phase 2: see PLAN.md section 5.4")
