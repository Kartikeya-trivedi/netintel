"""Relationship typing from verb cues and entity types."""

from __future__ import annotations

from app.services.extraction.ner import extract_entities
from app.services.extraction.relations import extract_relations


def _relations(text: str) -> dict[tuple[str, str], str]:
    entities = extract_entities(text)
    return {
        (r.source.text, r.target.text): r.rel_type
        for r in extract_relations(text, entities, doc_id=1)
    }


def test_transfer_verb_types_the_edge():
    rels = _relations("Ramesh Kulkarni transferred payment of Rs. 48,000 to Suresh Pawar.")
    assert rels[("Ramesh Kulkarni", "Suresh Pawar")] == "TRANSACTED_WITH"


def test_membership_points_person_at_organisation():
    rels = _relations("Suresh Pawar is a member of the Nightfall Syndicate.")
    assert any(
        source == "Suresh Pawar" and rel == "MEMBER_OF" for (source, _), rel in rels.items()
    )


def test_identifier_is_owned_not_called():
    """"Contacted on <number>" states whose phone it is, not a call between them."""
    rels = _relations("Ramesh Kulkarni was contacted on +91 9876543210.")
    assert rels[("Ramesh Kulkarni", "+91 9876543210")] == "OWNS"


def test_locative_cue_does_not_leak_across_a_sentence():
    """One "near" must not retype every pair in the sentence as LOCATED_AT.

    This is the failure the type constraints exist to prevent: a single locative
    word once turned person-to-person pairs into "located at" edges.
    """
    text = "Ramesh Kulkarni was observed meeting Suresh Pawar near Marol Naka."
    rels = _relations(text)
    assert rels[("Ramesh Kulkarni", "Suresh Pawar")] == "ASSOCIATES_WITH"
    assert rels[("Ramesh Kulkarni", "Marol Naka")] == "LOCATED_AT"


def test_every_relation_carries_its_evidence():
    """An edge an investigator cannot trace back to source text is not shippable."""
    text = "Ramesh Kulkarni was observed meeting Suresh Pawar near Marol Naka."
    relations = extract_relations(text, extract_entities(text), doc_id=7)
    assert relations
    for relation in relations:
        assert relation.evidence
        assert all(e["doc_id"] == 7 and e["snippet"] for e in relation.evidence)


def test_repeated_pairs_accumulate_weight():
    text = (
        "Ramesh Kulkarni met Suresh Pawar at Vashi. "
        "Ramesh Kulkarni met Suresh Pawar at Kurla West. "
        "Ramesh Kulkarni met Suresh Pawar at Dharavi."
    )
    relations = extract_relations(text, extract_entities(text), doc_id=1)
    pair = next(
        r
        for r in relations
        if {r.source.text, r.target.text} == {"Ramesh Kulkarni", "Suresh Pawar"}
    )
    assert pair.weight == 3


def test_sentences_never_cross_a_line_break():
    """Each report line is one statement; pairing across lines invents edges.

    The segmenter breaks on "Rs." and used to run the remainder of a line into
    the next, which paired people from unrelated statements and inflated the
    graph well past what the reports actually claimed.
    """
    from app.services.extraction.relations import _sentences

    report = (
        "Bank records show Bhai remitted Rs. 301,000 to Rajendra Qureshi on 2026-04-18.\n"
        "Balwant Pawar and Imran Sheikh were seen together outside Nhava Sheva.\n"
    )
    sentences = _sentences(report)

    assert len(sentences) == 2
    assert not any("\n" in text for _, _, text in sentences)

    rels = _relations(report)
    assert ("Bhai", "Balwant Pawar") not in rels
    assert ("Rajendra Qureshi", "Imran Sheikh") not in rels
