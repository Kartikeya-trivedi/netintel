"""Phase 2 extraction tests. Marked xfail until the pipeline lands."""

from __future__ import annotations

import pytest

from app.services.extraction import ner, resolver

SAMPLE_REPORT = (
    "FIR No. 214/2026 was registered at Andheri Police Station on 2026-03-04. "
    'Ramesh Kulkarni alias "Raja" was observed meeting Suresh Pawar near Marol Naka. '
    "A vehicle bearing registration MH 12 AB 1234 was used. Ramesh Kulkarni was "
    "later contacted on +91 9876543210 and funds moved to account 123456789012."
)


def test_normalize_name_strips_honorifics():
    assert resolver.normalize_name("Shri Ramesh Kulkarni") == "ramesh kulkarni"
    assert resolver.normalize_name("  Mr.  Suresh   Pawar ") == "suresh pawar"


def test_normalize_identifier_strips_country_code_and_separators():
    assert resolver.normalize_identifier("+91 98765-43210") == "9876543210"


@pytest.mark.parametrize(
    ("pattern_name", "expected"),
    [
        ("PHONE", "9876543210"),
        ("VEHICLE", "MH 12 AB 1234"),
        ("BANK_ACCOUNT", "123456789012"),
    ],
)
def test_domain_patterns_match_sample_report(pattern_name, expected):
    match = ner.PATTERNS[pattern_name].search(SAMPLE_REPORT)
    assert match is not None
    assert expected.replace(" ", "") in match.group(0).replace(" ", "")


@pytest.mark.xfail(reason="Phase 2: extract_entities not implemented yet", strict=True)
def test_extract_entities_finds_people_and_identifiers():
    found = ner.extract_entities(SAMPLE_REPORT)
    types = {e.entity_type for e in found}
    assert {"PERSON", "PHONE", "VEHICLE", "BANK_ACCOUNT"} <= types
    people = {e.text for e in found if e.entity_type == "PERSON"}
    assert "Ramesh Kulkarni" in people


@pytest.mark.xfail(reason="Phase 2: resolver not implemented yet", strict=True)
def test_resolver_merges_alias_into_canonical_entity():
    merged = resolver.resolve(
        [
            {"text": "Ramesh Kulkarni", "entity_type": "PERSON"},
            {"text": "Kulkarni, Ramesh", "entity_type": "PERSON"},
            {"text": "Suresh Pawar", "entity_type": "PERSON"},
        ]
    )
    assert len(merged) == 2
