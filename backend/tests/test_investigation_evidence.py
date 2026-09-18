"""Originals, extraction and lineage: the challenge cases of MASTER_PLAN.md section 9.

Each test names the failure it guards against. All inputs are small synthetic
documents written inline, so what is expected can be read straight off them.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.investigation import engine as E
from app.investigation import lineage
from app.investigation.extract import ExtractionError, extract
from app.investigation.normalize import identifier_key, person_key
from app.investigation.store import (
    ALTERED,
    INTACT,
    MISSING,
    EvidenceStore,
    IntegrityError,
    MissingOriginal,
)


def claims(text: str, case: str = "T-1"):
    return extract(text.encode(), case=case, kind="report").assertions


# --- Identifiers ------------------------------------------------------------------------------


def test_phone_spellings_share_one_key():
    keys = {
        identifier_key("phone", v)
        for v in ("+91 98670 12345", "919867012345", "09867012345", "9867012345")
    }
    assert keys == {"PHONE:9867012345"}


def test_country_code_folding_applies_to_phones_only():
    """A twelve-digit account that starts 91 is not the phone number inside it."""
    assert identifier_key("account", "919820012345") == "ACCOUNT:919820012345"
    assert identifier_key("account", "919820012345") != identifier_key("phone", "9820012345")


def test_one_digit_is_a_different_account():
    assert identifier_key("account", "501200334411") != identifier_key("account", "501200334412")


def test_name_order_does_not_split_a_person_but_spelling_does():
    assert person_key("C", "VAZE ROHIT") == person_key("C", "Rohit Vaze")
    assert person_key("C", "Shri Rohit Vaze") == person_key("C", "Rohit Vaze")
    assert person_key("C", "Rohit Vase") != person_key("C", "Rohit Vaze")


# --- Records ----------------------------------------------------------------------------------


def test_time_zones_are_normalised_before_comparison():
    raw = (
        b"caller,callee,timestamp,duration_sec\n"
        b"9867012345,9765500321,2026-05-12T10:00:00+05:30,60\n"
        b"919867012345,919765500321,2026-05-12T04:30:00Z,60\n"
    )
    first, second = extract(raw, case="T-1", kind="call_records").assertions
    assert first.start == second.start == datetime(2026, 5, 12, 4, 30, tzinfo=UTC)
    assert (first.subject, first.object) == (second.subject, second.object)


def test_validity_runs_to_the_end_of_the_last_day():
    raw = (
        b"identifier,identifier_type,owner_name,valid_from,valid_to\n"
        b"9867012345,phone,Sameer Khan,2024-11-02,2026-03-31\n"
    )
    (holding,) = extract(raw, case="T-1", kind="subscriber_records").assertions
    # 31 March IST is covered in full; 1 April IST is not.
    assert holding.end == datetime(2026, 3, 31, 18, 30, tzinfo=UTC)


def test_registered_mobile_is_a_second_holding_from_the_same_row():
    raw = (
        b"identifier,identifier_type,owner_name,valid_from,valid_to,registered_mobile\n"
        b"501200334411,account,Rohit Vaze,2025-05-20,,9820012345\n"
    )
    out = extract(raw, case="T-1", kind="subscriber_records")
    assert {a.object for a in out.assertions} == {"ACCOUNT:501200334411", "PHONE:9820012345"}
    assert {a.item for a in out.assertions} == {"row:1"}


def test_a_malformed_row_is_kept_and_reported_never_dropped_silently():
    raw = (
        b"caller,callee,timestamp,duration_sec\n"
        b"9867012345,9765500321,not a time,60\n"
        b"9867012345,9765500321,2026-05-12T10:00:00+05:30,60\n"
    )
    out = extract(raw, case="T-1", kind="call_records")
    assert [item.locator_key for item in out.items] == ["row:1", "row:2"]
    assert len(out.assertions) == 1
    assert out.warnings and out.warnings[0].startswith("row 1")


def test_items_keep_the_exact_original_row():
    raw = b"caller,callee,timestamp\n 9867012345 , 9765500321 ,2026-05-12T10:00:00+05:30\n"
    out = extract(raw, case="T-1", kind="call_records")
    assert out.items[0].content == " 9867012345 , 9765500321 ,2026-05-12T10:00:00+05:30"


def test_missing_required_column_refuses_the_file():
    with pytest.raises(ExtractionError):
        extract(b"caller,timestamp\n9867012345,2026-05-12\n", case="T-1", kind="call_records")


# --- Reports ----------------------------------------------------------------------------------


def test_a_witness_named_beside_a_suspect_is_not_an_associate():
    found = claims(
        "Pappu Shinde was seen with the women near the bus stand on 2026-05-12, and a "
        "tea-stall owner, Ganesh Pawar, saw them board a white van.\n"
    )
    assert not [a for a in found if a.predicate == E.LINK]


def test_a_denial_is_recorded_as_contrary_not_as_a_link():
    (denial,) = [
        a for a in claims("Ramesh Gupta denied knowing Deepak Mhatre.\n") if a.predicate == E.LINK
    ]
    assert denial.polarity == -1 and denial.detail == "denied"


def test_an_identifier_belongs_to_the_person_the_sentence_attaches_it_to():
    """Not to everyone the sentence names."""
    found = claims(
        "Informant stated that Sameer Khan, using mobile 9867012345, was in touch with "
        "Pappu Shinde about moving the women on 2026-05-12.\n"
    )
    holdings = [a for a in found if a.predicate == E.HOLDS]
    assert [(h.subject, h.object) for h in holdings] == [
        (person_key("T-1", "Sameer Khan"), "PHONE:9867012345")
    ]
    (link,) = [a for a in found if a.predicate == E.LINK]
    assert link.detail == "called"


def test_the_stated_date_anchors_a_claim_in_any_common_format():
    for written in ("2026-05-12", "12.05.2026", "12 May 2026"):
        found = claims(f"Sameer Khan used mobile 9867012345 on {written}.\n")
        (holding,) = [a for a in found if a.predicate == E.HOLDS]
        assert holding.start == datetime(2026, 5, 11, 18, 30, tzinfo=UTC), written


def test_header_names_the_accused_and_the_declared_source():
    out = extract(
        b"FIR No: 1/2026\nDate: 2026-05-15\nAccused: Pappu Shinde, Unknown\n"
        b"Source reference: GD 23/2026 Nashik Road PS\n\nNothing else.\n",
        case="T-1",
        kind="report",
    )
    accused = [a.subject for a in out.assertions if a.predicate == E.ACCUSED]
    assert accused == [person_key("T-1", "Pappu Shinde")]
    assert out.source_reference == "gd 23 2026 nashik road ps"


def test_extraction_is_deterministic_and_independent_of_other_documents():
    text = (
        b"Reference: GD 23/2026\n\nInformant stated that Sameer Khan, using mobile 9867012345, "
        b"was in touch with Pappu Shinde on 2026-05-12.\n"
    )
    first = extract(text, case="T-1", kind="report")
    extract(b"Accused: Sameer Khan\n\nSameer Khan met Pappu Shinde.\n", case="T-1", kind="report")
    again = extract(text, case="T-1", kind="report")
    assert first.assertions == again.assertions
    assert first.items == again.items


# --- Lineage ----------------------------------------------------------------------------------


def _corpus(docs: dict[str, str]):
    assertions, infos = [], {}
    for name, text in docs.items():
        out = extract(text.encode(), case="T-1", kind="report")
        assertions += out.assertions
        infos[("T-1", out.sha256)] = lineage.ArtifactInfo(
            out.sha256,
            "T-1",
            name,
            "report",
            out.reference,
            out.source_reference,
            out.document_date,
        )
    names = {info.sha256: info.filename for info in infos.values()}
    links = lineage.detect(assertions, infos)
    by_key = {a.key: a for a in assertions}
    return {
        (names[by_key[link.derivative].artifact], names[by_key[link.origin].artifact], link.basis)
        for link in links
    }


TIP = (
    "Date: 2026-05-14\nReference: GD 23/2026 Nashik Road PS\n\n"
    "Informant stated that Sameer Khan, using mobile 9867012345, was in touch with "
    "Pappu Shinde about moving the women on 2026-05-12.\n"
)


def test_a_declared_source_is_a_confirmed_link():
    bulletin = (
        "Date: 2026-05-18\nSource reference: GD 23/2026 Nashik Road PS\n\n"
        "One Sameer Khan (mobile 9867012345) is suspected of coordinating with Pappu Shinde "
        "on 12.05.2026.\n"
    )
    assert ("bulletin", "tip", "declared_reference") in _corpus({"tip": TIP, "bulletin": bulletin})


def test_a_near_verbatim_repeat_is_a_proposed_link_to_the_earlier_document():
    diary = TIP.replace("2026-05-14", "2026-05-16").replace("Informant stated", "Recorded")
    assert ("diary", "tip", "near_verbatim") in _corpus({"tip": TIP, "diary": diary})


def test_an_independent_account_in_other_words_stays_its_own_origin():
    witness = (
        "Date: 2026-05-20\n\nA second witness said she saw Sameer Khan, whose number was "
        "9867012345, speak by phone with Pappu Shinde on 2026-05-12.\n"
    )
    assert not _corpus({"tip": TIP, "witness": witness})


def test_the_same_call_in_two_exports_is_one_observation():
    ist = b"caller,callee,timestamp\n9867012345,9765500321,2026-05-12T10:00:00+05:30\n"
    utc = b"caller,callee,timestamp\n919867012345,919765500321,2026-05-12T04:30:40Z\n"
    assertions, infos = [], {}
    for name, raw in (("ist", ist), ("utc", utc)):
        out = extract(raw, case="T-1", kind="call_records")
        assertions += out.assertions
        infos[("T-1", out.sha256)] = lineage.ArtifactInfo(out.sha256, "T-1", name, "call_records")
    (link,) = lineage.detect(assertions, infos)
    assert link.basis == "same_event" and link.status == "proposed"


# --- The store --------------------------------------------------------------------------------


def test_originals_round_trip_by_digest(tmp_path):
    store = EvidenceStore(tmp_path)
    sha = store.put(b"original bytes")
    assert store.put(b"original bytes") == sha
    assert store.get(sha) == b"original bytes"
    assert store.verify(sha) == INTACT


def test_an_altered_original_is_refused_and_never_overwritten(tmp_path):
    store = EvidenceStore(tmp_path)
    sha = store.put(b"original bytes")
    store.path_for(sha).write_bytes(b"edited bytes")
    assert store.verify(sha) == ALTERED
    with pytest.raises(IntegrityError):
        store.get(sha)
    with pytest.raises(IntegrityError):
        store.put(b"original bytes")
    assert store.path_for(sha).read_bytes() == b"edited bytes"


def test_a_missing_original_is_reported(tmp_path):
    store = EvidenceStore(tmp_path)
    sha = store.put(b"original bytes")
    store.path_for(sha).unlink()
    assert store.verify(sha) == MISSING
    with pytest.raises(MissingOriginal):
        store.get(sha)
