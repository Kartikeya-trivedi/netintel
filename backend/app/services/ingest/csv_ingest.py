"""Parse transaction, call-record, and subscriber CSVs.

Consumed by services.ingest.pipeline.

Canonical headers are what the demo generator emits. The alias table lets a
judge drop in their own export without renaming columns first, which is the
difference between a demo that survives contact with real data and one that
only works on ours.
"""

from __future__ import annotations

import io
import logging
from datetime import UTC, datetime
from typing import Any

import pandas as pd

logger = logging.getLogger(__name__)

COLUMN_ALIASES: dict[str, dict[str, tuple[str, ...]]] = {
    "transactions": {
        "txn_ref": ("txn_id", "txn_ref", "transaction_id", "reference"),
        "from_account": ("from_account", "sender", "debit_account", "from"),
        "to_account": ("to_account", "beneficiary", "credit_account", "to"),
        "amount": ("amount", "amt", "value"),
        "timestamp": ("timestamp", "date", "datetime", "txn_date"),
    },
    "call_records": {
        "caller": ("caller", "a_party", "from", "calling_number"),
        "callee": ("callee", "b_party", "to", "called_number"),
        "timestamp": ("timestamp", "date", "datetime", "call_time"),
        "duration_sec": ("duration_sec", "duration", "secs"),
    },
    "subscriber_records": {
        "identifier": ("identifier", "phone", "account", "number"),
        "identifier_type": ("identifier_type", "type"),
        "owner_name": ("owner_name", "subscriber", "name", "holder"),
    },
}

REQUIRED_COLUMNS: dict[str, tuple[str, ...]] = {
    "transactions": ("from_account", "to_account", "amount", "timestamp"),
    "call_records": ("caller", "callee", "timestamp"),
    "subscriber_records": ("identifier", "owner_name"),
}

NUMERIC_COLUMNS = frozenset({"amount", "duration_sec"})
TIMESTAMP_COLUMNS = frozenset({"timestamp"})


class CsvSchemaError(ValueError):
    """Raised when a CSV lacks a column the document type requires."""


def _resolve_headers(columns: list[str], doc_type: str) -> dict[str, str]:
    """Map incoming header names onto canonical names, case-insensitively."""
    lookup = {str(c).strip().casefold(): str(c) for c in columns}
    mapping: dict[str, str] = {}
    for canonical, aliases in COLUMN_ALIASES[doc_type].items():
        for alias in aliases:
            actual = lookup.get(alias.casefold())
            if actual is not None:
                mapping[canonical] = actual
                break
    return mapping


def _coerce_timestamp(value: Any) -> datetime | None:
    stamp = pd.to_datetime(value, errors="coerce", utc=True)
    if pd.isna(stamp):
        return None
    return stamp.to_pydatetime().astimezone(UTC)


def parse_csv(raw: bytes, doc_type: str) -> list[dict]:
    """Return normalised row dicts keyed by canonical column names.

    Rows missing a required field are dropped rather than raising, so one
    malformed line cannot cost an investigator the other four hundred. The drop
    count is logged so silent data loss stays visible.
    """
    if doc_type not in COLUMN_ALIASES:
        raise CsvSchemaError(f"No CSV schema registered for doc_type {doc_type!r}")

    # dtype=str throughout: a single blank cell makes pandas infer float for the
    # whole column, which would silently turn account "222" into "222.0" and
    # break every downstream join on that identifier.
    frame = pd.read_csv(io.BytesIO(raw), dtype=str, keep_default_na=False, na_values=[""])
    mapping = _resolve_headers(list(frame.columns), doc_type)

    missing = [c for c in REQUIRED_COLUMNS[doc_type] if c not in mapping]
    if missing:
        raise CsvSchemaError(
            f"{doc_type} CSV is missing required column(s): {', '.join(missing)}. "
            f"Found headers: {', '.join(map(str, frame.columns))}"
        )

    rows: list[dict] = []
    dropped = 0

    for record in frame.to_dict(orient="records"):
        row: dict[str, Any] = {}
        for canonical, actual in mapping.items():
            value = record.get(actual)

            if canonical in TIMESTAMP_COLUMNS:
                value = _coerce_timestamp(value)
            elif canonical in NUMERIC_COLUMNS:
                value = pd.to_numeric(value, errors="coerce")
                value = None if pd.isna(value) else float(value)
            elif value is not None and not pd.isna(value):
                value = str(value).strip()
            else:
                value = None

            row[canonical] = value

        if any(row.get(required) in (None, "") for required in REQUIRED_COLUMNS[doc_type]):
            dropped += 1
            continue
        rows.append(row)

    if dropped:
        logger.warning("Dropped %s malformed %s row(s) during ingest", dropped, doc_type)

    return rows
