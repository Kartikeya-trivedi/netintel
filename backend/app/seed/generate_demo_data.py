"""Generate the synthetic Operation Nightfall case (PLAN.md section 7).

Run:  uv run python -m app.seed.generate_demo_data

Deterministic: seeded RNG means the same network, the same anomalies, and the
same demo every single time. Output lands in app/seed/demo_assets/.

The ground-truth network is designed so the analytics have something real to
find. The kingpin is deliberately given LOW direct visibility -- few mentions,
few direct links -- but HIGH betweenness, because every path between the three
cells runs through the two lieutenants who report to him. Degree centrality will
not surface him. Betweenness will. That contrast is the demo.
"""

from __future__ import annotations

import random
from pathlib import Path

SEED = 20260824
OUTPUT_DIR = Path(__file__).parent / "demo_assets"

CASE_NAME = "Operation Nightfall"
CASE_DESCRIPTION = (
    "Synthetic multi-cell smuggling syndicate used to demonstrate NetIntel. "
    "All names, numbers, and records are fabricated."
)

# Network shape: 1 kingpin -> 2 lieutenants -> 3 cells, plus a launderer who
# bridges the syndicate to a shell company, and couriers linking cells.
N_CELLS = 3
CELL_SIZE = 5
N_REPORTS = 14
N_TRANSACTIONS = 500
N_CALL_RECORDS = 800
TIMELINE_DAYS = 90

# The scripted event the communication burst precedes.
INCIDENT_DAY_OFFSET = 61

REPORT_TEMPLATES = [
    (
        "FIR No. {fir}/2026 was registered at {station} Police Station on {date}. "
        "During surveillance, {suspect_a} alias \"{alias_a}\" was observed meeting "
        "{suspect_b} near {location}. A vehicle bearing registration {vehicle} was "
        "used to transport the consignment. {suspect_a} was later contacted on {phone}."
    ),
    (
        "Acting on intelligence, a team intercepted {suspect_a} at {location} on {date}. "
        "{quantity} of {contraband} was recovered. During interrogation, {suspect_a} "
        "disclosed that payment of Rs. {amount} was transferred to account {account} "
        "held by {suspect_b}, who is a member of the {org}."
    ),
    (
        "Call detail record analysis shows {suspect_a} contacted {suspect_b} repeatedly "
        "between {date} and {date_end}. {suspect_b} operates from {location} and is "
        "affiliated with the {org}. Financial records indicate {suspect_b} remitted "
        "Rs. {amount} to {suspect_c} on {date_end}."
    ),
]


def main() -> None:
    """Generate all demo assets into OUTPUT_DIR.

    TODO(Phase 1): implement.
      1. random.Random(SEED); build the ground-truth roster and adjacency
      2. render N_REPORTS reports from REPORT_TEMPLATES into .txt files
      3. transactions.csv  -> txn_id, from_account, to_account, amount, timestamp
         with a spike and a structuring run planted on the launderer account
      4. call_records.csv  -> caller, callee, timestamp, duration_sec
         with a burst in the 48h before INCIDENT_DAY_OFFSET
      5. subscriber_records.csv -> identifier, identifier_type, owner_name
      6. ground_truth.json -> roles and adjacency, so tests can assert that the
         analytics actually recover the planted structure
      All timestamps ISO-8601 (YYYY-MM-DDTHH:MM:SS+05:30).
    """
    random.Random(SEED)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    raise NotImplementedError("Phase 1: see PLAN.md section 7")


if __name__ == "__main__":
    main()
