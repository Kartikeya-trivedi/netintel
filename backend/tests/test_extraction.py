"""Entity extraction, alias handling, and resolution."""

from __future__ import annotations

import pytest

from app.services.extraction import resolver
from app.services.extraction.ner import alias_links, extract_entities

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
    assert resolver.normalize_identifier("9876543210") == "9876543210"


def test_extract_entities_finds_people_and_identifiers():
    found = extract_entities(SAMPLE_REPORT)
    types = {e.entity_type for e in found}
    assert {"PERSON", "PHONE", "VEHICLE", "BANK_ACCOUNT"} <= types

    people = {e.text for e in found if e.entity_type == "PERSON"}
    assert "Ramesh Kulkarni" in people
    assert "Suresh Pawar" in people


def test_fir_reference_is_not_an_organisation():
    """A case reference identifies the document, not a node in the network."""
    surfaces = {e.text for e in extract_entities(SAMPLE_REPORT)}
    assert not any(s.startswith("FIR") for s in surfaces)


def test_place_after_locative_preposition_is_a_location():
    """Statistical NER reads Indian place names as people; the cue word corrects it."""
    typed = {e.text: e.entity_type for e in extract_entities(SAMPLE_REPORT)}
    assert typed.get("Marol Naka") == "LOCATION"


def test_run_on_spans_are_rejected():
    """A span that swallowed a verb has overrun the name and is not an entity."""
    surfaces = {
        e.text for e in extract_entities("Bhai remitted Rs. 48,000 to Rajendra Qureshi.")
    }
    assert "Rajendra Qureshi" in surfaces
    assert not any("remitted" in s for s in surfaces)


def test_alias_links_capture_quoted_and_bare_forms():
    assert alias_links('Salim More alias "Bhai" was seen.') == [("Salim More", "Bhai")]
    assert alias_links("Ramesh Kulkarni alias Raja was seen.") == [("Ramesh Kulkarni", "Raja")]


def test_alias_folds_into_the_person_it_names():
    """"X alias Y" is stronger evidence than any similarity score."""
    text = 'Salim More alias "Bhai" met Sanjay Rane. Bhai later called Sanjay Rane again.'
    entities = extract_entities(text)
    candidates = [
        {"text": e.text, "entity_type": e.entity_type, "start": e.start, "end": e.end}
        for e in entities
    ]
    clusters = resolver.apply_alias_links(resolver.resolve(candidates), alias_links(text))

    kingpin = next(c for c in clusters if c["canonical_name"] == "Salim More")
    assert "Bhai" in kingpin["aliases"]
    assert len(kingpin["members"]) == 3
    assert not any(c["canonical_name"] == "Bhai" for c in clusters)


def test_resolver_merges_reordered_names():
    merged = resolver.resolve(
        [
            {"text": "Ramesh Kulkarni", "entity_type": "PERSON"},
            {"text": "Kulkarni, Ramesh", "entity_type": "PERSON"},
            {"text": "Suresh Pawar", "entity_type": "PERSON"},
        ]
    )
    assert len(merged) == 2
    assert merged[0]["canonical_name"] == "Ramesh Kulkarni"


@pytest.mark.parametrize(
    ("left", "right", "should_merge"),
    [
        ("Ramesh Kulkarni", "Kulkarni, Ramesh", True),
        ("Shri Ramesh Kulkarni", "Ramesh Kulkarni", True),
        ("Salim More", "Salim Moree", True),
        # Two different people who happen to share a surname must stay apart.
        # At the old threshold of 90 these scored 91.7 and silently fused.
        ("Kiran Ansari", "Imran Ansari", False),
        ("Sanjay Rane", "Sanjay Mhatre", False),
    ],
)
def test_names_match_separates_distinct_people(left, right, should_merge):
    assert resolver.names_match(left, right) is should_merge


def test_identifiers_never_merge_fuzzily():
    """One digit apart is a different account, not a typo."""
    merged = resolver.resolve(
        [
            {"text": "123456789012", "entity_type": "BANK_ACCOUNT"},
            {"text": "123456789013", "entity_type": "BANK_ACCOUNT"},
        ]
    )
    assert len(merged) == 2
