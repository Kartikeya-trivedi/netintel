"""Type-specific normalisation for identifiers and person names.

Consumed by investigation.extract, investigation.lineage and investigation.engine.

Identifiers are normalised by the rules of their own type and never fuzzed. A
phone number and an account number are different kinds of thing, so country
code folding applies to phones only: a twelve-digit account that happens to
begin with 91 is not the ten-digit phone number inside it. The older resolver
folds any twelve-character identifier, which is exactly the collision this
module refuses to make.

Person keys are case-local on purpose. "Sameer Khan" in one case file and
"Sameer Khan" in another are two references until an investigator decides they
are one person; the key never makes that decision for them.
"""

from __future__ import annotations

import re
import unicodedata

PHONE = "PHONE"
ACCOUNT = "ACCOUNT"

_HONORIFIC = re.compile(r"^(?:shri|smt|kumari|km|mr|mrs|ms|dr|sh|md|mohd)\.?\s+", re.IGNORECASE)
_CASE_CODE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.\-]{0,39}$")


def normalize_phone(value: str) -> str:
    """Digits only, national ten-digit form where the input carries a prefix.

    +91, 91 and the domestic trunk 0 all prefix the same subscriber number, so
    all three spellings of one phone land on one key.
    """
    digits = re.sub(r"\D", "", value)
    if len(digits) == 12 and digits.startswith("91"):
        return digits[2:]
    if len(digits) == 11 and digits.startswith("0"):
        return digits[1:]
    return digits


def normalize_account(value: str) -> str:
    """Separators out, case folded up, and nothing else touched.

    Leading zeros are part of an account number, and no prefix is ever
    stripped: a one-character difference is a different account.
    """
    return re.sub(r"[\s\-./]", "", value).upper()


def identifier_key(kind: str, value: str) -> str:
    """Stable key for an identifier, e.g. ``PHONE:9867012345``."""
    folded = kind.strip().upper()
    if folded in {"PHONE", "MOBILE", "MSISDN"}:
        normalized = normalize_phone(value)
        prefix = PHONE
    elif folded in {"ACCOUNT", "BANK_ACCOUNT", "BANK ACCOUNT"}:
        normalized = normalize_account(value)
        prefix = ACCOUNT
    else:
        raise ValueError(f"Unknown identifier type {kind!r}")
    if not normalized:
        raise ValueError(f"Empty {prefix.lower()} identifier {value!r}")
    return f"{prefix}:{normalized}"


def identifier_value(key: str) -> str:
    """The normalised value inside an identifier key."""
    return key.split(":", 1)[1]


def identifier_type(key: str) -> str:
    return key.split(":", 1)[0]


def name_tokens(name: str) -> tuple[str, ...]:
    """Casefolded name tokens, honorific stripped, sorted.

    Sorted because records invert names ("VAZE ROHIT") while prose does not,
    and word order is the one variation that never distinguishes two people in
    these sources. Spelling differences are left alone: they are a question
    for identity review, not for a key.
    """
    text = unicodedata.normalize("NFKC", name).strip()
    text = _HONORIFIC.sub("", text)
    tokens = (token.strip(".,;:\"'()[]") for token in text.casefold().split())
    return tuple(sorted(token for token in tokens if token))


def validate_case_code(code: str) -> str:
    if not _CASE_CODE.match(code):
        raise ValueError(f"Case code {code!r} must be 1-40 characters of letters, digits, _ . -")
    return code


def person_key(case: str, name: str) -> str:
    """Case-local person key, e.g. ``P:BM-1:khan sameer``."""
    tokens = name_tokens(name)
    if not tokens:
        raise ValueError(f"Cannot key an empty name {name!r}")
    return f"P:{validate_case_code(case)}:{' '.join(tokens)}"


def is_person(key: str) -> bool:
    return key.startswith("P:")


def case_of(key: str) -> str:
    """Case code of a person key."""
    return key.split(":", 2)[1]


def name_of(key: str) -> str:
    """Normalised name part of a person key."""
    return key.split(":", 2)[2]
