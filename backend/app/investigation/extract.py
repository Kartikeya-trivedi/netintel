"""One original in; evidence items and typed assertions out.

Consumed by investigation.service (ingest) and investigation.package (the
verifier re-extracts originals to reproduce an exported finding).

Extraction is per document. Nothing learned from one document reaches another:
no case gazetteer, no list of known suspects, no shared prompt. The legacy
pipeline feeds names found in earlier reports into later ones, which reads well
but means withdrawing a report does not withdraw what it taught the extractor.
Here a document's assertions depend on its bytes and the extractor version and
nothing else, which is what makes a withdrawal checkable against a clean
re-extraction of the permitted originals.

Locators: CSV items are data rows (1-based, header excluded) with the physical
line they start on; report items are character spans into the UTF-8 decoded
text, byte-order mark removed. Every item keeps the exact original text.
"""

from __future__ import annotations

import csv
import io
import re
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta, timezone
from itertools import combinations

from app.investigation.engine import (
    ACCUSED,
    CLAIM,
    CONTACT,
    HOLDS,
    LINK,
    RECORD,
    TRANSFER,
    Assertion,
    short_hash,
)
from app.investigation.normalize import (
    identifier_key,
    name_tokens,
    normalize_phone,
    person_key,
)
from app.investigation.store import digest
from app.services.ingest.csv_ingest import COLUMN_ALIASES, REQUIRED_COLUMNS

EXTRACTOR_VERSION = "netintel-assertions/1"

IST = timezone(timedelta(hours=5, minutes=30), "IST")

REPORT = "report"
CALL_RECORDS = "call_records"
TRANSACTIONS = "transactions"
SUBSCRIBER_RECORDS = "subscriber_records"
KINDS = (REPORT, CALL_RECORDS, TRANSACTIONS, SUBSCRIBER_RECORDS)

# Columns the legacy parser ignores but the evidence layer needs: validity
# periods are the difference between "this number was his" and "this number is
# his", and a bank KYC row often names the holder's registered mobile.
EXTRA_COLUMNS: dict[str, dict[str, tuple[str, ...]]] = {
    SUBSCRIBER_RECORDS: {
        "valid_from": ("valid_from", "activation_date", "from_date", "start_date"),
        "valid_to": ("valid_to", "deactivation_date", "to_date", "end_date"),
        "registered_mobile": ("registered_mobile", "linked_mobile", "mobile"),
    },
    TRANSACTIONS: {"narration": ("narration", "remarks", "description")},
    CALL_RECORDS: {},
}

HEADER_FIELDS = {
    "fir no": "fir",
    "fir": "fir",
    "police station": "station",
    "station": "station",
    "date": "date",
    "accused": "accused",
    "reference": "reference",
    "source reference": "source_reference",
    "title": "title",
    "document": "title",
}

_HEADER_LINE = re.compile(r"^\s*([A-Za-z][A-Za-z .]{0,40}?)\s*:\s*(.+?)\s*$")
_NOT_A_NAME = frozenset({"unknown", "unidentified", "others", "nil", "none", "n/a"})

# Sentence-level denial cues. A denial is kept as contrary evidence, never
# dropped and never read as support.
_NEGATION = re.compile(
    r"\b(?:denied|denies|deny|never met|never spoke|never called|no contact|"
    r"not known to|does not know|did not know|refused to identify)\b",
    re.IGNORECASE,
)

_MONTHS = {
    name: index
    for index, names in enumerate(
        [
            ("january", "jan"),
            ("february", "feb"),
            ("march", "mar"),
            ("april", "apr"),
            ("may",),
            ("june", "jun"),
            ("july", "jul"),
            ("august", "aug"),
            ("september", "sep", "sept"),
            ("october", "oct"),
            ("november", "nov"),
            ("december", "dec"),
        ],
        start=1,
    )
    for name in names
}
_DATE_PATTERNS = (
    re.compile(r"\b(?P<y>20\d{2})-(?P<m>\d{2})-(?P<d>\d{2})\b"),
    re.compile(r"\b(?P<d>\d{1,2})[./](?P<m>\d{1,2})[./](?P<y>20\d{2})\b"),
    re.compile(
        r"\b(?P<d>\d{1,2})(?:st|nd|rd|th)?\s+(?P<mon>[A-Za-z]{3,9})\.?,?\s+(?P<y>20\d{2})\b"
    ),
)

# How far an identifier may sit from the person it is attached to.
_ATTACH_WINDOW = 60

# Two names in one sentence are not a relationship. A claim needs the sentence
# to join them: a relational phrase ending right before the second name ("was
# in touch with", "his associate"), or "A and B met". A witness named beside a
# suspect ("seen with the women, and a tea-stall owner, X, saw them") is left
# as a mention, never promoted to an associate.
_LINK_BEFORE = re.compile(
    r"(?P<cue>in touch with|in contact with|coordinating with|working with|worked for|works for|"
    r"collected dues for|on (?:the )?instructions of|on behalf of|handed (?:them |her )?over to|"
    r"met|meeting|called|phoned|contacted|paid|remitted|transferred|associate|accomplice|partner|"
    r"denied knowing|does not know|did not know|never met|never spoke to)"
    r"\s+(?:(?:his|her|their|the|one|a|an)\s+)?(?:(?:associate|accomplice|partner)\s+)?$",
    re.IGNORECASE,
)
_PAIR_JOIN = re.compile(r"^\s*(?:and|&)\s*$", re.IGNORECASE)
_LINK_AFTER = re.compile(r"^\s+(?:met|were seen together|spoke|were in touch)\b", re.IGNORECASE)


def _link_cue(gap: str, after: str) -> str | None:
    """How a sentence joins two names, or None when it merely names both."""
    match = _LINK_BEFORE.search(gap)
    if match:
        cue = match.group("cue").casefold()
    elif _PAIR_JOIN.match(gap) and _LINK_AFTER.match(after):
        cue = _LINK_AFTER.match(after).group(0).strip().casefold()
    else:
        return None
    if cue.startswith(("denied", "does not", "did not", "never")):
        return "denied"
    if any(word in cue for word in ("call", "phon", "contact", "touch")):
        return "called"
    if any(word in cue for word in ("paid", "remitted", "transferred")):
        return "paid"
    return "associated"


_MOMENT_FORMATS = ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d-%m-%Y %H:%M:%S", "%d-%m-%Y %H:%M")
_DAY_FORMATS = ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y")


class ExtractionError(ValueError):
    """The original cannot be read as the kind it was declared to be."""


@dataclass(frozen=True, slots=True)
class Item:
    locator_key: str
    locator: dict
    content: str


@dataclass
class Extraction:
    kind: str
    sha256: str
    items: list[Item] = field(default_factory=list)
    assertions: list[Assertion] = field(default_factory=list)
    reference: str | None = None
    source_reference: str | None = None
    document_date: datetime | None = None
    title: str | None = None
    warnings: list[str] = field(default_factory=list)
    method: str = EXTRACTOR_VERSION


def extract(
    raw: bytes, *, case: str, kind: str, sha256: str | None = None, tz: timezone = IST
) -> Extraction:
    """Extract one original. Deterministic for fixed bytes and extractor version."""
    if kind not in KINDS:
        raise ExtractionError(f"Unknown artifact kind {kind!r}; expected one of {KINDS}")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ExtractionError(f"Original is not UTF-8 text: {exc}") from exc

    out = Extraction(kind=kind, sha256=sha256 or digest(raw))
    if kind == REPORT:
        _extract_report(text, case, tz, out)
    else:
        _extract_records(text, case, kind, tz, out)
    return out


# --- Shared helpers ------------------------------------------------------------


class _Emitter:
    """Numbers assertions within an item so keys are stable across re-runs."""

    def __init__(self, out: Extraction, case: str) -> None:
        self.out = out
        self.case = case
        self.counts: dict[str, int] = {}

    def item(self, locator_key: str, locator: dict, content: str) -> None:
        self.out.items.append(Item(locator_key, locator, content))

    def emit(self, locator_key: str, **fields) -> None:
        ordinal = self.counts.get(locator_key, 0)
        self.counts[locator_key] = ordinal + 1
        key = "a-" + short_hash(self.case, self.out.sha256, locator_key, str(ordinal))
        self.out.assertions.append(
            Assertion(
                key=key,
                case=self.case,
                artifact=self.out.sha256,
                item=locator_key,
                **fields,
            )
        )


def _to_utc(value: datetime, tz: timezone) -> datetime:
    if value.tzinfo is None:
        value = value.replace(tzinfo=tz)
    return value.astimezone(UTC)


def parse_moment(value: str | None, tz: timezone = IST) -> datetime | None:
    """A timestamp, with a naive one read in the artifact's own time zone."""
    if not value or not value.strip():
        return None
    text = value.strip()
    try:
        return _to_utc(datetime.fromisoformat(text), tz)
    except ValueError:
        pass
    for pattern in _MOMENT_FORMATS:
        try:
            return _to_utc(datetime.strptime(text, pattern), tz)
        except ValueError:
            continue
    return None


def parse_day(value: str | None, tz: timezone = IST) -> datetime | None:
    """Local midnight at the start of a stated day."""
    if not value or not value.strip():
        return None
    text = value.strip()
    for pattern in _DAY_FORMATS:
        try:
            return _to_utc(datetime.strptime(text, pattern), tz)
        except ValueError:
            continue
    return None


def first_date(text: str, tz: timezone = IST) -> datetime | None:
    """The earliest-placed date written in a sentence, as local midnight."""
    found: list[tuple[int, datetime]] = []
    for pattern in _DATE_PATTERNS:
        for match in pattern.finditer(text):
            parts = match.groupdict()
            month = int(parts["m"]) if parts.get("m") else _MONTHS.get(parts["mon"].casefold())
            if month is None:
                continue
            try:
                stated = datetime(int(parts["y"]), month, int(parts["d"]))
            except ValueError:
                continue
            found.append((match.start(), _to_utc(stated, tz)))
    return min(found)[1] if found else None


def _normalize_reference(value: str) -> str:
    return " ".join(re.sub(r"[^\w]+", " ", value.casefold()).split())


def _infer_identifier_kind(value: str) -> str:
    digits = normalize_phone(value)
    return "PHONE" if len(digits) == 10 and digits[0] in "6789" else "ACCOUNT"


# --- Structured records ----------------------------------------------------------


def _resolve_columns(header: list[str], kind: str) -> dict[str, int]:
    lookup = {name.strip().casefold(): index for index, name in enumerate(header)}
    aliases = {**COLUMN_ALIASES[kind], **EXTRA_COLUMNS.get(kind, {})}
    mapping: dict[str, int] = {}
    taken: set[int] = set()
    for canonical, names in aliases.items():
        for name in names:
            index = lookup.get(name.casefold())
            if index is not None and index not in taken:
                mapping[canonical] = index
                taken.add(index)
                break
    missing = [c for c in REQUIRED_COLUMNS[kind] if c not in mapping]
    if missing:
        raise ExtractionError(
            f"{kind} is missing required column(s) {', '.join(missing)}; found {', '.join(header)}"
        )
    return mapping


def _rows(text: str, kind: str) -> Iterator[tuple[int, int, str, dict[str, str]]]:
    """(row number, first physical line, exact row text, canonical fields)."""
    lines = list(io.StringIO(text, newline=""))
    reader = csv.reader(io.StringIO(text, newline=""))
    try:
        header = next(reader)
    except StopIteration as exc:
        raise ExtractionError("CSV has no header row") from exc
    mapping = _resolve_columns(header, kind)

    consumed = reader.line_num
    number = 0
    for values in reader:
        first, consumed = consumed, reader.line_num
        if not any(value.strip() for value in values):
            continue
        number += 1
        exact = "".join(lines[first:consumed]).rstrip("\r\n")
        fields = {
            canonical: values[index].strip() if index < len(values) else ""
            for canonical, index in mapping.items()
        }
        yield number, first + 1, exact, fields


def _extract_records(text: str, case: str, kind: str, tz: timezone, out: Extraction) -> None:
    emitter = _Emitter(out, case)
    for number, line, exact, row in _rows(text, kind):
        locator_key = f"row:{number}"
        emitter.item(locator_key, {"kind": "row", "row": number, "line": line}, exact)
        try:
            if kind == CALL_RECORDS:
                _call_row(row, locator_key, emitter, tz)
            elif kind == TRANSACTIONS:
                _transfer_row(row, locator_key, emitter, tz)
            else:
                _subscriber_row(row, case, locator_key, emitter, tz)
        except ValueError as exc:
            # The row stays as an evidence item; it just asserts nothing. Kept
            # visible rather than dropped, so data loss is never silent.
            out.warnings.append(f"row {number}: {exc}")


def _call_row(row: dict, locator_key: str, emitter: _Emitter, tz: timezone) -> None:
    when = parse_moment(row.get("timestamp"), tz)
    if when is None:
        raise ValueError(f"unreadable timestamp {row.get('timestamp')!r}")
    duration = row.get("duration_sec") or None
    emitter.emit(
        locator_key,
        predicate=CONTACT,
        subject=identifier_key("PHONE", row["caller"]),
        object=identifier_key("PHONE", row["callee"]),
        start=when,
        kind=RECORD,
        detail=f"{duration}s" if duration else None,
        text=f"{row['caller']} called {row['callee']}",
    )


def _transfer_row(row: dict, locator_key: str, emitter: _Emitter, tz: timezone) -> None:
    when = parse_moment(row.get("timestamp"), tz)
    if when is None:
        raise ValueError(f"unreadable timestamp {row.get('timestamp')!r}")
    try:
        amount = float(row["amount"].replace(",", ""))
    except ValueError as exc:
        raise ValueError(f"unreadable amount {row['amount']!r}") from exc
    emitter.emit(
        locator_key,
        predicate=TRANSFER,
        subject=identifier_key("ACCOUNT", row["from_account"]),
        object=identifier_key("ACCOUNT", row["to_account"]),
        start=when,
        kind=RECORD,
        amount=amount,
        detail=row.get("txn_ref") or None,
        text=f"{row['from_account']} paid {row['to_account']} Rs. {amount:,.2f}",
    )


def _subscriber_row(
    row: dict, case: str, locator_key: str, emitter: _Emitter, tz: timezone
) -> None:
    owner = row["owner_name"]
    declared = (row.get("identifier_type") or "").strip().casefold()
    if declared in {"phone", "mobile", "msisdn"}:
        id_kind = "PHONE"
    elif declared in {"account", "bank account", "bank_account"}:
        id_kind = "ACCOUNT"
    else:
        id_kind = _infer_identifier_kind(row["identifier"])

    start = parse_day(row.get("valid_from"), tz)
    last_day = parse_day(row.get("valid_to"), tz)
    if (row.get("valid_from") and start is None) or (row.get("valid_to") and last_day is None):
        raise ValueError("unreadable validity date")
    # valid_to names the last day covered, so the interval runs to the next midnight.
    end = last_day + timedelta(days=1) if last_day else None
    if start and end and end <= start:
        raise ValueError("validity ends before it starts")

    subject = person_key(case, owner)
    emitter.emit(
        locator_key,
        predicate=HOLDS,
        subject=subject,
        object=identifier_key(id_kind, row["identifier"]),
        start=start,
        end=end,
        kind=RECORD,
        detail="registered holder",
        subject_label=owner,
        text=f"{row['identifier']} registered to {owner}",
    )
    mobile = row.get("registered_mobile")
    if mobile:
        emitter.emit(
            locator_key,
            predicate=HOLDS,
            subject=subject,
            object=identifier_key("PHONE", mobile),
            start=start,
            end=end,
            kind=RECORD,
            detail="registered mobile",
            subject_label=owner,
            text=f"{mobile} registered as mobile of {owner}",
        )


# --- Narrative reports -----------------------------------------------------------------


def _header(text: str, case: str, tz: timezone, emitter: _Emitter, out: Extraction) -> int:
    """Read leading ``Key: value`` lines; return where the body begins."""
    offset = 0
    for line in io.StringIO(text, newline=""):
        content = line.rstrip("\r\n")
        if not content.strip():
            return offset + len(line)
        match = _HEADER_LINE.match(content)
        field_name = (
            HEADER_FIELDS.get(match.group(1).strip().casefold().rstrip(".")) if match else None
        )
        if field_name is None:
            return offset

        value = match.group(2)
        locator_key = f"span:{offset}-{offset + len(content)}"
        emitter.item(
            locator_key, {"kind": "span", "start": offset, "end": offset + len(content)}, content
        )

        if field_name == "accused":
            for name in re.split(r",|;|\band\b", value):
                name = name.strip(" .")
                if name and name.casefold() not in _NOT_A_NAME and name_tokens(name):
                    emitter.emit(
                        locator_key,
                        predicate=ACCUSED,
                        subject=person_key(case, name),
                        kind=CLAIM,
                        subject_label=name,
                        text=content,
                    )
        elif field_name == "reference":
            out.reference = _normalize_reference(value)
        elif field_name == "source_reference":
            out.source_reference = _normalize_reference(value)
        elif field_name == "date":
            out.document_date = parse_day(value, tz) or first_date(value, tz)
        elif field_name == "title":
            out.title = value
        offset += len(line)
    # Header lines all the way down: the document has no body.
    return offset


def _attach(identifier, persons: list) -> object | None:
    """The person an identifier belongs to: the nearest mention either side.

    Pairing every identifier with every person in the sentence, as the
    co-occurrence extractor does, hands one suspect's number to everyone named
    alongside him. The nearest mention is how the sentence itself attaches it.
    """
    best: tuple[int, int, object] | None = None
    for person in persons:
        if person.end <= identifier.start:
            gap, side = identifier.start - person.end, 0
        elif person.start >= identifier.end:
            gap, side = person.start - identifier.end, 1
        else:
            continue
        if gap <= _ATTACH_WINDOW and (best is None or (gap, side) < best[:2]):
            best = (gap, side, person)
    return best[2] if best else None


def _extract_report(text: str, case: str, tz: timezone, out: Extraction) -> None:
    from app.services.extraction.ner import extract_entities
    from app.services.extraction.relations import _sentences

    emitter = _Emitter(out, case)
    body_start = _header(text, case, tz, emitter, out)
    body = text[body_start:]
    if not body.strip():
        return

    entities = extract_entities(body)
    for start, end, sentence in _sentences(body):
        inside = [e for e in entities if e.start >= start and e.end <= end]
        persons = [e for e in inside if e.entity_type == "PERSON" and name_tokens(e.text)]
        identifiers = [e for e in inside if e.entity_type in ("PHONE", "BANK_ACCOUNT")]
        if not persons:
            continue

        absolute = body_start + start
        locator_key = f"span:{absolute}-{body_start + end}"
        polarity = -1 if _NEGATION.search(sentence) else 1
        stated = first_date(sentence, tz)
        emitted_before = len(out.assertions)

        for identifier in identifiers:
            owner = _attach(identifier, persons)
            if owner is None:
                continue
            kind = "PHONE" if identifier.entity_type == "PHONE" else "ACCOUNT"
            emitter.emit(
                locator_key,
                predicate=HOLDS,
                subject=person_key(case, owner.text),
                object=identifier_key(kind, identifier.text),
                start=stated or out.document_date,
                polarity=polarity,
                kind=CLAIM,
                detail="stated in report",
                subject_label=owner.text,
                text=sentence,
            )

        seen: set[tuple[str, str]] = set()
        for left, right in combinations(persons, 2):
            a, b = person_key(case, left.text), person_key(case, right.text)
            if a == b or (a, b) in seen:
                continue
            cue = _link_cue(body[left.end : right.start], body[right.end : end])
            if cue is None:
                continue
            seen.add((a, b))
            denied = cue == "denied" or polarity < 0
            emitter.emit(
                locator_key,
                predicate=LINK,
                subject=a,
                object=b,
                start=stated,
                polarity=-1 if denied else 1,
                kind=CLAIM,
                detail="denied" if denied else cue,
                subject_label=left.text,
                object_label=right.text,
                text=sentence,
            )

        if len(out.assertions) > emitted_before:
            emitter.item(
                locator_key,
                {"kind": "span", "start": absolute, "end": body_start + end},
                text[absolute : body_start + end],
            )
