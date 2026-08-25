"""Parse transaction, call-record, and subscriber CSVs (PLAN.md section 5.1).

Phase 1. Consumed by services.ingest.pipeline.

Canonical headers are what the demo generator emits; the aliases below let a
judge drop in their own CSV without renaming columns first.
"""

from __future__ import annotations

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


def parse_csv(raw: bytes, doc_type: str) -> list[dict]:
    """Return normalised row dicts keyed by canonical column names.

    TODO(Phase 1): implement fully.
      1. pandas.read_csv over the bytes
      2. map incoming headers to canonical names via COLUMN_ALIASES (case-insensitive)
      3. coerce amount to float and timestamp to tz-aware datetime (ISO-8601)
      4. drop rows missing a required field, and report how many were dropped
    """
    raise NotImplementedError("Phase 1: see PLAN.md section 5.1")
