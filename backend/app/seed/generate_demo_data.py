"""Generate the synthetic Operation Nightfall case.

Run:  uv run python -m app.seed.generate_demo_data

Deterministic: a seeded RNG means the same network, the same anomalies, and the
same demo every time. Output lands in app/seed/demo_assets/.

Every name, number, account, and event here is fabricated. No real person, case,
or institution is represented.

Network design
--------------
The structure is chosen so the analytics have something real to recover. Cells
are cliques, so members never need an intermediary to reach each other and no
cell member accumulates betweenness from their own neighbours. Each cell reaches
the rest of the syndicate only through its lieutenant, and the lieutenants reach
each other only through the kingpin.

The result is a kingpin with lower degree than a cell gateway and far fewer
report mentions than any street operative, yet the highest betweenness in the
network by a wide margin. Counting mentions or contacts hides him; graph
structure exposes him. That contrast is the entire demo.
"""

from __future__ import annotations

import csv
import json
import random
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

SEED = 20260824
OUTPUT_DIR = Path(__file__).parent / "demo_assets"

CASE_NAME = "Operation Nightfall"
CASE_DESCRIPTION = (
    "Synthetic multi-cell smuggling syndicate used to demonstrate NetIntel. "
    "All names, numbers, and records are fabricated."
)

IST = timezone(timedelta(hours=5, minutes=30))
START_DATE = datetime(2026, 3, 1, tzinfo=IST)
TIMELINE_DAYS = 90

# The scripted enforcement action the communication burst precedes.
INCIDENT_DAY = 61

N_TRANSACTIONS = 500
N_CALL_RECORDS = 800
CELL_SIZE = 5

# Just under the 50,000 reporting threshold, repeated: the classic smurfing
# signature the structuring detector is built to catch.
STRUCTURING_AMOUNT_RANGE = (45_000, 49_500)
STRUCTURING_RUN = 6

LOCATIONS = [
    "Marol Naka", "Dharavi", "Bhiwandi", "Nhava Sheva", "Kurla West",
    "Malad East", "Vashi", "Govandi", "Sewri Docks", "Andheri East",
]
STATIONS = ["Andheri", "Kurla", "Bhiwandi", "Vashi", "Malad"]
CONTRABAND = ["heroin", "charas", "mephedrone", "opium"]
QUANTITIES = ["1.2 kg", "480 grams", "3.4 kg", "750 grams", "2 kg"]

FIRST_NAMES = [
    "Ramesh", "Suresh", "Imran", "Devendra", "Balwant", "Nitin", "Farhan",
    "Sanjay", "Prakash", "Rafiq", "Yusuf", "Manoj", "Ashok", "Vinod", "Salim",
    "Dinesh", "Rajendra", "Iqbal", "Mahesh", "Anil", "Kiran", "Pravin",
]
LAST_NAMES = [
    "Kulkarni", "Pawar", "Qureshi", "Shinde", "Sekhon", "Bhalerao", "Sheikh",
    "Deshmukh", "Jadhav", "Ansari", "More", "Gaikwad", "Chavan", "Salvi",
    "Naik", "Rane", "Bhosale", "Kadam", "Patil", "Mhatre", "Sawant", "Tambe",
]


@dataclass
class Person:
    key: str
    name: str
    role: str
    phone: str
    account: str
    alias: str | None = None
    vehicle: str | None = None
    cell: str | None = None


@dataclass
class Network:
    people: list[Person]
    org_name: str
    shell_name: str
    # Undirected association edges, as (key, key) pairs.
    edges: list[tuple[str, str]] = field(default_factory=list)

    def by_key(self, key: str) -> Person:
        return next(p for p in self.people if p.key == key)

    def role(self, role: str) -> list[Person]:
        return [p for p in self.people if p.role == role]


def _phone(rng: random.Random) -> str:
    return f"{rng.choice('6789')}{''.join(str(rng.randint(0, 9)) for _ in range(9))}"


def _account(rng: random.Random) -> str:
    return "".join(str(rng.randint(0, 9)) for _ in range(12))


def _vehicle(rng: random.Random) -> str:
    return (
        f"MH {rng.randint(1, 48):02d} "
        f"{rng.choice('ABCDEFGHJKLMNPQRSTUVWXYZ')}{rng.choice('ABCDEFGHJKLMNPQRSTUVWXYZ')} "
        f"{rng.randint(1000, 9999)}"
    )


def build_network(rng: random.Random) -> Network:
    """Assemble the roster and the ground-truth adjacency."""
    used_names: set[str] = set()

    def fresh_name() -> str:
        while True:
            name = f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}"
            if name not in used_names:
                used_names.add(name)
                return name

    people: list[Person] = []

    def add(key: str, role: str, **kwargs) -> Person:
        person = Person(
            key=key,
            name=fresh_name(),
            role=role,
            phone=_phone(rng),
            account=_account(rng),
            **kwargs,
        )
        people.append(person)
        return person

    # The kingpin is referred to almost entirely by his alias, which is exactly
    # why alias resolution has to work before the graph means anything.
    add("kingpin", "kingpin", alias="Bhai")
    add("launderer", "launderer")
    add("accountant", "accountant")

    cells = ["alpha", "bravo", "charlie"]
    for cell in cells:
        add(f"lt_{cell}", "lieutenant", cell=cell, vehicle=_vehicle(rng))
        for member in range(CELL_SIZE):
            role = "gateway" if member == 0 else "operative"
            add(
                f"{cell}_{member}",
                role,
                cell=cell,
                vehicle=_vehicle(rng) if member % 3 == 0 else None,
            )

    network = Network(people=people, org_name="Nightfall Syndicate", shell_name="Meridian Exim")

    edges: list[tuple[str, str]] = []
    for cell in cells:
        members = [f"{cell}_{i}" for i in range(CELL_SIZE)]
        # Cells are cliques: everyone inside knows everyone else.
        edges += [(a, b) for i, a in enumerate(members) for b in members[i + 1 :]]
        # The cell touches the rest of the network only through its lieutenant.
        edges.append((f"lt_{cell}", members[0]))
        edges.append((f"lt_{cell}", members[1]))
        # Lieutenants answer only to the kingpin.
        edges.append(("kingpin", f"lt_{cell}"))

    edges.append(("kingpin", "launderer"))
    edges.append(("launderer", "accountant"))

    network.edges = edges
    return network


def _name_in_report(person: Person, introduced: set[str]) -> str:
    """How this person is referred to in prose.

    The kingpin is introduced once with his alias and referred to by nickname
    afterwards, which is how he stays low-visibility in any single report while
    still collapsing to one entity once resolution runs.
    """
    if person.alias is None:
        return person.name
    if person.key not in introduced:
        introduced.add(person.key)
        return f'{person.name} alias "{person.alias}"'
    return person.alias


MEETING_TEMPLATES = [
    "{a} was observed meeting {b} near {loc} on {date}.",
    "Surveillance placed {a} in the company of {b} at {loc} on {date}.",
    "{a} and {b} were seen together outside {loc} on {date}.",
]

MONEY_TEMPLATES = [
    "{a} transferred payment of Rs. {amount} to {b} on {date}.",
    "Bank records show {a} remitted Rs. {amount} to {b} on {date}.",
]

CALL_TEMPLATES = [
    "{a} contacted {b} repeatedly between {date} and {date_end}.",
    "Call detail records show {a} phoned {b} on {date}.",
]


def render_reports(net: Network, rng: random.Random) -> list[tuple[str, str]]:
    """Render police reports whose prose encodes the ground-truth adjacency.

    Every edge is stated in at least one sentence, so a correct extractor can
    rebuild the network from text alone. That is what makes the recovered graph
    a real result rather than something the seeder handed to itself.
    """
    introduced: set[str] = set()
    edges = list(net.edges)
    rng.shuffle(edges)

    per_report = 6
    chunks = [edges[i : i + per_report] for i in range(0, len(edges), per_report)]
    reports: list[tuple[str, str]] = []

    for index, chunk in enumerate(chunks, start=1):
        station = rng.choice(STATIONS)
        fir = f"{rng.randint(100, 499)}/2026"
        opened = (START_DATE + timedelta(days=rng.randint(0, TIMELINE_DAYS - 1))).strftime(
            "%Y-%m-%d"
        )
        lines = [f"FIR No. {fir} was registered at {station} Police Station on {opened}."]

        for left_key, right_key in chunk:
            left = net.by_key(left_key)
            right = net.by_key(right_key)
            a = _name_in_report(left, introduced)
            b = _name_in_report(right, introduced)
            edge_day = rng.randint(0, TIMELINE_DAYS - 1)
            edge_date = (START_DATE + timedelta(days=edge_day)).strftime("%Y-%m-%d")
            end_date = (
                START_DATE + timedelta(days=min(edge_day + 4, TIMELINE_DAYS))
            ).strftime("%Y-%m-%d")

            money = {"launderer", "accountant"} & {left_key, right_key}
            if money:
                template = rng.choice(MONEY_TEMPLATES)
            elif left_key.startswith("lt_") or right_key.startswith("lt_"):
                template = rng.choice(CALL_TEMPLATES + MEETING_TEMPLATES)
            else:
                template = rng.choice(MEETING_TEMPLATES)

            lines.append(
                template.format(
                    a=a,
                    b=b,
                    loc=rng.choice(LOCATIONS),
                    date=edge_date,
                    date_end=end_date,
                    amount=f"{rng.randrange(20, 400) * 1000:,}",
                )
            )

        subject = net.by_key(chunk[0][0])
        lines.append(
            f"{rng.choice(QUANTITIES)} of {rng.choice(CONTRABAND)} was recovered at "
            f"{rng.choice(LOCATIONS)} during the operation."
        )
        if subject.vehicle:
            lines.append(
                f"A vehicle bearing registration {subject.vehicle} was used to move "
                "the consignment."
            )
        lines.append(f"{subject.name} was later contacted on {subject.phone}.")
        if subject.role in {"gateway", "operative"}:
            lines.append(f"{subject.name} is a member of the {net.org_name}.")

        reports.append((f"report_{index:02d}.txt", "\n".join(lines) + "\n"))

    return reports


def _stamp(day: int, rng: random.Random) -> str:
    moment = START_DATE + timedelta(
        days=day, hours=rng.randint(6, 23), minutes=rng.randint(0, 59)
    )
    return moment.isoformat()


def build_transactions(net: Network, rng: random.Random) -> list[dict]:
    """Money moving up the chain, with a spike and a structuring run planted.

    Transfers only ever follow an edge that already exists in the ground-truth
    adjacency, and are oriented up the hierarchy. Inventing sender/receiver
    pairs freely would quietly add links the reports never described, handing
    the graph structure the extractor could not have derived from the evidence.
    """
    launderer = net.by_key("launderer")
    accountant = net.by_key("accountant")
    rows: list[dict] = []
    counter = 0

    def emit(sender: Person, receiver: Person, amount: float, day: int) -> None:
        nonlocal counter
        counter += 1
        rows.append(
            {
                "txn_id": f"TXN{counter:05d}",
                "from_account": sender.account,
                "to_account": receiver.account,
                "amount": f"{amount:.2f}",
                "timestamp": _stamp(day, rng),
            }
        )

    # Money flows toward higher rank.
    rank = {
        "operative": 0,
        "gateway": 1,
        "lieutenant": 2,
        "accountant": 2,
        "kingpin": 3,
        "launderer": 3,
    }
    oriented: list[tuple[Person, Person]] = []
    for left_key, right_key in net.edges:
        left, right = net.by_key(left_key), net.by_key(right_key)
        if rank[left.role] == rank[right.role]:
            continue
        if rank[left.role] < rank[right.role]:
            oriented.append((left, right))
        else:
            oriented.append((right, left))

    budget = N_TRANSACTIONS - (STRUCTURING_RUN + 12)
    while counter < budget:
        sender, receiver = rng.choice(oriented)
        emit(sender, receiver, rng.randrange(5, 120) * 1000, rng.randint(0, TIMELINE_DAYS - 1))

    # Planted anomaly 1: structuring. Six transfers just under the reporting
    # threshold inside one week, launderer to shell accountant.
    for offset in range(STRUCTURING_RUN):
        emit(launderer, accountant, rng.randrange(*STRUCTURING_AMOUNT_RANGE), 40 + (offset % 6))

    # Planted anomaly 2: a single-day spike far outside the launderer baseline.
    for _ in range(12):
        emit(launderer, accountant, rng.randrange(800, 1500) * 1000, INCIDENT_DAY - 3)

    rows.sort(key=lambda r: r["timestamp"])
    return rows


def build_calls(net: Network, rng: random.Random) -> list[dict]:
    """Call traffic along the contact edges, with a burst before the incident."""
    rows: list[dict] = []
    contact_edges = [
        (a, b)
        for a, b in net.edges
        if "launderer" not in (a, b) and "accountant" not in (a, b)
    ]

    def emit(a: Person, b: Person, day: int) -> None:
        rows.append(
            {
                "caller": a.phone,
                "callee": b.phone,
                "timestamp": _stamp(day, rng),
                "duration_sec": str(rng.randint(20, 900)),
            }
        )

    while len(rows) < N_CALL_RECORDS - 60:
        left, right = rng.choice(contact_edges)
        emit(net.by_key(left), net.by_key(right), rng.randint(0, TIMELINE_DAYS - 1))

    # Planted anomaly 3: coordination chatter in the 48 hours before the raid.
    burst_pairs = [("kingpin", "lt_alpha"), ("lt_alpha", "alpha_0"), ("alpha_0", "alpha_1")]
    for _ in range(60):
        left, right = rng.choice(burst_pairs)
        emit(net.by_key(left), net.by_key(right), rng.choice([INCIDENT_DAY - 2, INCIDENT_DAY - 1]))

    rows.sort(key=lambda r: r["timestamp"])
    return rows


def build_subscribers(net: Network) -> list[dict]:
    """KYC-style mapping that joins bare identifiers to named people."""
    rows: list[dict] = []
    for person in net.people:
        rows.append(
            {"identifier": person.phone, "identifier_type": "phone", "owner_name": person.name}
        )
        rows.append(
            {"identifier": person.account, "identifier_type": "account", "owner_name": person.name}
        )
    return rows


def _write_text(path: Path, text: str) -> None:
    """Write with explicit LF endings.

    Path.write_text uses the platform default, so the same seed produced CRLF
    files on Windows and LF on Linux. That is not cosmetic: it changes
    tokenisation, and with it the entities and edges extracted, which made the
    demo assets -- and every analytic conclusion drawn from them -- differ by
    operating system.
    """
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)


def _write_csv(path: Path, rows: list[dict]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    """Generate every demo asset into OUTPUT_DIR."""
    rng = random.Random(SEED)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    net = build_network(rng)

    for filename, text in render_reports(net, rng):
        _write_text(OUTPUT_DIR / filename, text)

    _write_csv(OUTPUT_DIR / "transactions.csv", build_transactions(net, rng))
    _write_csv(OUTPUT_DIR / "call_records.csv", build_calls(net, rng))
    _write_csv(OUTPUT_DIR / "subscriber_records.csv", build_subscribers(net))

    # Ground truth lets the test suite assert that analytics recovered the
    # planted structure, rather than merely producing plausible-looking output.
    ground_truth = {
        "case_name": CASE_NAME,
        "description": CASE_DESCRIPTION,
        "seed": SEED,
        "incident_day": INCIDENT_DAY,
        "kingpin": asdict(net.by_key("kingpin")),
        "people": [asdict(p) for p in net.people],
        "edges": net.edges,
        "expected": {
            "top_betweenness_role": "kingpin",
            "min_communities": 3,
            "components_after_kingpin_removal": 4,
        },
    }
    _write_text(OUTPUT_DIR / "ground_truth.json", json.dumps(ground_truth, indent=2))

    print(f"Wrote demo assets to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
