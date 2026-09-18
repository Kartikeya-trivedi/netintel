"""Generate Operation Broken Mirror: three case files, one real bridge, one false one.

Run:  uv run python -m app.seed.broken_mirror          (writes broken_mirror_assets/)

The flagship investigation of MASTER_PLAN.md section 3. Every name, number,
account and event is fabricated. Complainants are never named: in these case
types the law protects a complainant's identity, and a synthetic demo should
model that habit rather than break it.

What is planted
---------------
The real bridge. Rohit Vaze moves the loan-app ring's money (BM-1) and pays and
phones the recruiter Deepak Mhatre (BM-2), who hands women on to Pappu Shinde
(BM-3). Bank transfers and call records each support it independently.

The false bridge. An informant tip says Sameer Khan, BM-1's recovery agent,
was in touch with Pappu Shinde on 12 May, using mobile 9867012345. That number
was Sameer's until 31 March and was re-issued to Anil Borade, the van driver
who really made those calls, on 20 April. The tip is copied near-verbatim into
a station diary and paraphrased into a district bulletin that cites it: three
documents, one origin.

The noise. An unrelated taxi customer shares a name with BM-1's mule account
holder; the taxi driver is in contact with nearly everyone; the same calls
appear in more than one call-record export, in different time zones; one
account differs from Rohit's by a single digit; and one twelve-digit account
happens to contain Rohit's phone number after a 91.

Ground truth goes to ground_truth.json. Only evaluation and tests read it; the
analysis path never does.
"""

from __future__ import annotations

import csv
import io
import json
import random
from dataclasses import asdict, dataclass, replace
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent / "broken_mirror_assets"
SCENARIO_NAME = "Operation Broken Mirror"
DEFAULT_SEED = 0

IST = timezone(timedelta(hours=5, minutes=30))

# code, case name, agency, description
CASES = [
    (
        "BM-1",
        "Broken Mirror BM-1: loan-app extortion",
        "Andheri Cyber Police Station, Mumbai",
        "Women borrowers threatened by loan-app recovery agents and made to pay into "
        "mule accounts. Synthetic: every name, number and record is fabricated.",
    ),
    (
        "BM-2",
        "Broken Mirror BM-2: fake job-offer recruitment",
        "Thane Nagar Police Station",
        "Women recruited through fake hotel-job offers, then unreachable. Synthetic: "
        "every name, number and record is fabricated.",
    ),
    (
        "BM-3",
        "Broken Mirror BM-3: missing women inquiry",
        "Nashik Road Police Station",
        "Three women reported missing from Nashik Road after a job offer. Synthetic: "
        "every name, number and record is fabricated.",
    ),
]


@dataclass(frozen=True)
class Cast:
    vikram: str = "Vikram Rane"
    sameer: str = "Sameer Khan"
    rohit: str = "Rohit Vaze"
    kiran: str = "Kiran Salvi"
    deepak: str = "Deepak Mhatre"
    pappu: str = "Pappu Shinde"
    anil: str = "Anil Borade"
    taxi: str = "Ramesh Gupta"
    customers: tuple[str, ...] = ("Asha Kulkarni", "Prakash Jadhav", "Meena Rao", "Sanjay More")

    vikram_phone: str = "9819004455"
    sameer_phone: str = "9867012345"
    rohit_phone: str = "9820012345"
    kiran_phone: str = "9930011002"
    other_kiran_phone: str = "9822200506"
    deepak_phone: str = "9004411223"
    pappu_phone: str = "9765500321"
    taxi_phone: str = "9833300111"
    customer_phones: tuple[str, ...] = ("9822200501", "9822200502", "9822200503", "9822200505")
    victim_phones: tuple[str, ...] = (
        "9811100201",
        "9811100202",
        "9811100203",
        "9811100204",
        "9811100205",
        "9811100206",
    )

    mule_account: str = "401100220033"
    rohit_account: str = "501200334411"
    vikram_account: str = "602100118822"
    deepak_account: str = "302200445566"
    near_miss_account: str = "501200334412"
    victim_accounts: tuple[str, ...] = (
        "100200300401",
        "100200300402",
        "100200300403",
        "100200300404",
        "100200300405",
    )
    shop_accounts: tuple[str, ...] = ("700100200301", "700100200302")

    seed: int = DEFAULT_SEED

    @property
    def prefixed_account(self) -> str:
        """A twelve-digit account that is 91 followed by Rohit's phone digits."""
        return "91" + self.rohit_phone


FIRST = [
    "Aarav",
    "Imran",
    "Nitin",
    "Farhan",
    "Sunil",
    "Yusuf",
    "Manoj",
    "Harish",
    "Salim",
    "Dinesh",
    "Rajesh",
    "Iqbal",
    "Mahesh",
    "Anand",
    "Tushar",
    "Pravin",
    "Ganesh",
    "Omkar",
]
LAST = [
    "Kulkarni",
    "Pawar",
    "Qureshi",
    "Shinde",
    "Bhalerao",
    "Sheikh",
    "Deshmukh",
    "Jadhav",
    "Gaikwad",
    "Chavan",
    "Salvi",
    "Naik",
    "Rane",
    "Bhosale",
    "Kadam",
    "Patil",
    "Mhatre",
    "Sawant",
    "Tambe",
    "Waghmare",
    "Lokhande",
    "Kamble",
]
WOMEN = ["Asha", "Meena", "Sunita", "Rekha", "Pooja", "Kavita", "Neha", "Lata"]


def default_cast() -> Cast:
    return Cast()


def random_cast(seed: int) -> Cast:
    """Same structure, different names and numbers. Guards against a pipeline
    that only works because it has seen these particular strings."""
    rng = random.Random(seed)
    used: set[str] = set()

    def name(firsts: list[str] = FIRST) -> str:
        while True:
            candidate = f"{rng.choice(firsts)} {rng.choice(LAST)}"
            if candidate not in used:
                used.add(candidate)
                return candidate

    numbers: set[str] = set()

    def phone() -> str:
        while True:
            candidate = f"{rng.choice('6789')}{rng.randrange(10**8, 10**9)}"
            if candidate not in numbers:
                numbers.add(candidate)
                return candidate

    def account() -> str:
        while True:
            candidate = f"{rng.randrange(1, 9)}{rng.randrange(10**10, 10**11)}"
            if candidate not in numbers and not candidate.startswith("91"):
                numbers.add(candidate)
                return candidate

    rohit_account = account()
    near_miss = rohit_account[:-1] + str((int(rohit_account[-1]) + 1) % 10)
    return Cast(
        vikram=name(),
        sameer=name(),
        rohit=name(),
        kiran=name(),
        deepak=name(),
        pappu=name(),
        anil=name(),
        taxi=name(),
        customers=tuple(name(WOMEN) for _ in range(4)),
        vikram_phone=phone(),
        sameer_phone=phone(),
        rohit_phone=phone(),
        kiran_phone=phone(),
        other_kiran_phone=phone(),
        deepak_phone=phone(),
        pappu_phone=phone(),
        taxi_phone=phone(),
        customer_phones=tuple(phone() for _ in range(4)),
        victim_phones=tuple(phone() for _ in range(6)),
        mule_account=account(),
        rohit_account=rohit_account,
        vikram_account=account(),
        deepak_account=account(),
        near_miss_account=near_miss,
        victim_accounts=tuple(account() for _ in range(5)),
        shop_accounts=tuple(account() for _ in range(2)),
        seed=seed,
    )


# --- Formatting helpers -------------------------------------------------------


def _csv(header: list[str], rows: list[list[str]]) -> bytes:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(header)
    writer.writerows(rows)
    return buffer.getvalue().encode("utf-8")


def _text(lines: list[str]) -> bytes:
    return ("\n".join(lines) + "\n").encode("utf-8")


def _ist(value: datetime) -> str:
    return value.astimezone(IST).isoformat(timespec="seconds")


def _utc(value: datetime) -> str:
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _at(day: str, hh: int, mm: int) -> datetime:
    return datetime.fromisoformat(day).replace(hour=hh, minute=mm, tzinfo=IST)


class _Clock:
    """Deterministic event times inside a window, one per call."""

    def __init__(self, rng: random.Random) -> None:
        self.rng = rng

    def between(self, first: str, last: str, count: int) -> list[datetime]:
        """``count`` distinct minutes, uniform over the days, waking hours only."""
        start = datetime.fromisoformat(first).replace(tzinfo=IST)
        days = (datetime.fromisoformat(last) - datetime.fromisoformat(first)).days + 1
        moments: set[datetime] = set()
        while len(moments) < count:
            moments.add(
                start
                + timedelta(
                    days=self.rng.randrange(days),
                    hours=self.rng.randint(8, 22),
                    minutes=self.rng.randrange(60),
                )
            )
        return sorted(moments)

    def duration(self) -> str:
        return str(self.rng.randint(25, 640))


@dataclass(frozen=True)
class CaseFile:
    filename: str
    kind: str
    raw: bytes
    source_org: str


# --- The three case files --------------------------------------------------------


def build_case_files(cast: Cast) -> dict[str, list[CaseFile]]:
    """Every original, per case code, in the order an investigator received them."""
    rng = random.Random(10_000 + cast.seed)
    clock = _Clock(rng)
    c = cast

    # Calls that appear in two exports: the same event, twice observed.
    deepak_pappu = [(t, clock.duration()) for t in clock.between("2026-05-02", "2026-05-11", 6)]
    deepak_taxi = [
        (t, clock.duration()) for t in (_at("2026-04-18", 18, 5), _at("2026-04-25", 9, 40))
    ]
    pappu_taxi = [
        (t, clock.duration()) for t in (_at("2026-05-05", 11, 15), _at("2026-05-09", 20, 2))
    ]

    files: dict[str, list[CaseFile]] = {}

    # BM-1 -----------------------------------------------------------------
    andheri = "Andheri Cyber Police Station, Mumbai"
    fir1 = _text(
        [
            "FIR No: 112/2026",
            f"Police Station: {andheri}",
            "Date: 2026-02-18",
            f"Accused: {c.vikram}, {c.sameer}",
            "Reference: FIR 112/2026 Andheri Cyber PS",
            "",
            "The complainant (identity withheld) took a loan of Rs. 12,000 through the "
            "QuickRupee mobile application in January 2026.",
            "From 2026-02-02 onwards she received calls demanding Rs. 48,000 and threatening "
            "to circulate morphed photographs.",
            f"The caller identified himself as {c.sameer}, a recovery agent, calling from "
            f"mobile {c.sameer_phone}.",
            f"{c.sameer} said that he collected dues for {c.vikram}, who ran the QuickRupee "
            "application.",
            f"She transferred Rs. 18,500 to account {c.mule_account} on 2026-02-09 after "
            "the threats.",
        ]
    )
    statement1 = _text(
        [
            "Title: Statement of second complainant",
            f"Police Station: {andheri}",
            "Date: 2026-03-06",
            "Reference: Statement 2 in FIR 112/2026 Andheri Cyber PS",
            "",
            "The second complainant (identity withheld) borrowed Rs. 8,000 through the same "
            "application in February 2026.",
            f"On 2026-03-01 a man who gave his name as {c.sameer} threatened her from mobile "
            f"{c.sameer_phone}.",
            f"She paid Rs. 15,000 into account {c.mule_account} on 2026-03-02.",
        ]
    )
    telecom1 = _csv(
        ["identifier", "identifier_type", "owner_name", "valid_from", "valid_to"],
        [
            [c.vikram_phone, "phone", c.vikram, "2023-05-10", ""],
            [c.sameer_phone, "phone", c.sameer, "2024-11-02", "2026-03-31"],
            [c.rohit_phone, "phone", c.rohit, "2025-06-01", ""],
            [c.kiran_phone, "phone", c.kiran, "2024-02-01", ""],
        ],
    )
    bank_kyc1 = _csv(
        [
            "identifier",
            "identifier_type",
            "owner_name",
            "valid_from",
            "valid_to",
            "registered_mobile",
        ],
        [
            [c.mule_account, "account", c.kiran, "2025-11-03", "", c.kiran_phone],
            [c.rohit_account, "account", c.rohit, "2025-05-20", "", c.rohit_phone],
            [c.vikram_account, "account", c.vikram, "2022-01-15", "", c.vikram_phone],
        ],
    )
    statement_rows: list[list[str]] = []
    counter = 0

    def txn(
        payer: str, payee: str, amount: int, when: datetime, narration: str, sink: list
    ) -> None:
        nonlocal counter
        counter += 1
        sink.append([f"TXN{counter:05d}", payer, payee, f"{amount:.2f}", _ist(when), narration])

    for when in clock.between("2026-02-05", "2026-03-20", 12):
        txn(
            rng.choice(c.victim_accounts),
            c.mule_account,
            rng.randrange(8, 26) * 1000,
            when,
            "UPI/QuickRupee repayment",
            statement_rows,
        )
    txn(
        c.prefixed_account,
        c.mule_account,
        9_500,
        _at("2026-02-21", 13, 12),
        "IMPS/repayment",
        statement_rows,
    )
    for when in clock.between("2026-02-12", "2026-03-26", 6):
        txn(
            c.mule_account,
            c.rohit_account,
            rng.randrange(40, 91) * 1000,
            when,
            "IMPS/sweep",
            statement_rows,
        )
    for when in clock.between("2026-02-20", "2026-04-08", 5):
        txn(
            c.rohit_account,
            c.vikram_account,
            rng.randrange(100, 151) * 1000,
            when,
            "NEFT/consultancy",
            statement_rows,
        )
    statement_rows.sort(key=lambda row: row[4])
    statement1_csv = _csv(
        ["txn_id", "from_account", "to_account", "amount", "timestamp", "narration"],
        statement_rows,
    )

    cdr1: list[list[str]] = []
    for when in clock.between("2026-02-02", "2026-03-12", 16):
        cdr1.append([c.sameer_phone, rng.choice(c.victim_phones), _ist(when), clock.duration()])
    for index, when in enumerate(clock.between("2026-02-03", "2026-03-25", 8)):
        pair = (c.sameer_phone, c.vikram_phone) if index % 2 else (c.vikram_phone, c.sameer_phone)
        cdr1.append([*pair, _ist(when), clock.duration()])
    for index, when in enumerate(clock.between("2026-02-10", "2026-04-05", 6)):
        pair = (c.vikram_phone, c.rohit_phone) if index % 2 else (c.rohit_phone, c.vikram_phone)
        cdr1.append([*pair, _ist(when), clock.duration()])
    for when in clock.between("2026-02-15", "2026-03-30", 4):
        cdr1.append([c.vikram_phone, c.kiran_phone, _ist(when), clock.duration()])
    cdr1.sort(key=lambda row: row[2])

    files["BM-1"] = [
        CaseFile("BM1_FIR_112-2026.txt", "report", fir1, andheri),
        CaseFile("BM1_statement_complainant2.txt", "report", statement1, andheri),
        CaseFile(
            "BM1_telecom_subscribers.csv",
            "subscriber_records",
            telecom1,
            "Telecom operator (notice response)",
        ),
        CaseFile("BM1_bank_kyc.csv", "subscriber_records", bank_kyc1, "Bank (KYC response)"),
        CaseFile(
            "BM1_bank_statement.csv", "transactions", statement1_csv, "Bank (account statement)"
        ),
        CaseFile(
            "BM1_cdr_accused.csv",
            "call_records",
            _csv(["caller", "callee", "timestamp", "duration_sec"], cdr1),
            "Telecom operator (CDR)",
        ),
    ]

    # BM-2 -----------------------------------------------------------------
    thane = "Thane Nagar Police Station"
    fir2 = _text(
        [
            "FIR No: 098/2026",
            f"Police Station: {thane}",
            "Date: 2026-04-22",
            f"Accused: {c.deepak}",
            "Reference: FIR 98/2026 Thane Nagar PS",
            "",
            "The complainant (identity withheld) answered an online advertisement for hotel "
            "jobs in March 2026.",
            f"{c.deepak} interviewed her and collected a registration fee of Rs. 5,000.",
            f"{c.deepak} called her from mobile {c.deepak_phone} on 2026-03-28.",
            f"{c.deepak} told her that his associate {c.rohit} would arrange travel and "
            "accommodation.",
            f"Other women recruited by {c.deepak} could not be contacted after they left for "
            "the jobs.",
        ]
    )
    note2 = _text(
        [
            "Title: Verification note",
            f"Police Station: {thane}",
            "Date: 2026-05-02",
            "Reference: Note 14/2026 Thane Nagar PS",
            "",
            f"A complainant mentioned travelling in a cab driven by {c.taxi}, "
            f"mobile {c.taxi_phone}.",
            f"{c.taxi} was questioned and his call records were obtained.",
            f"{c.taxi} denied knowing {c.deepak} beyond ordinary cab bookings.",
        ]
    )
    telecom2_rows = [
        [c.deepak_phone, "phone", c.deepak, "2025-02-01", ""],
        [c.rohit_phone, "phone", c.rohit.upper(), "2025-06-01", ""],
        [c.pappu_phone, "phone", c.pappu, "2024-08-10", ""],
        [c.taxi_phone, "phone", c.taxi, "2019-03-01", ""],
        [c.other_kiran_phone, "phone", c.kiran, "2022-06-12", ""],
    ]
    telecom2_rows += [
        [number, "phone", person, "2021-01-01", ""]
        for person, number in zip(c.customers, c.customer_phones, strict=True)
    ]
    telecom2 = _csv(
        ["identifier", "identifier_type", "owner_name", "valid_from", "valid_to"], telecom2_rows
    )
    bank_kyc2 = _csv(
        [
            "identifier",
            "identifier_type",
            "owner_name",
            "valid_from",
            "valid_to",
            "registered_mobile",
        ],
        [[c.deepak_account, "account", c.deepak, "2024-10-01", "", c.deepak_phone]],
    )
    statement2_rows: list[list[str]] = []
    for when in clock.between("2026-03-18", "2026-04-28", 4):
        txn(
            c.rohit_account,
            c.deepak_account,
            rng.randrange(25, 41) * 1000,
            when,
            f"IMPS/{c.rohit.upper()}/{c.rohit_account}",
            statement2_rows,
        )
    txn(
        c.near_miss_account,
        c.deepak_account,
        12_000,
        _at("2026-04-03", 16, 30),
        "IMPS/rent refund",
        statement2_rows,
    )
    for when in clock.between("2026-03-08", "2026-04-12", 6):
        txn(
            rng.choice(c.victim_accounts),
            c.deepak_account,
            5_000,
            when,
            "UPI/registration fee",
            statement2_rows,
        )
    for when in clock.between("2026-03-10", "2026-05-10", 4):
        txn(
            c.deepak_account,
            rng.choice(c.shop_accounts),
            rng.randrange(2, 9) * 1000,
            when,
            "POS/purchase",
            statement2_rows,
        )
    statement2_rows.sort(key=lambda row: row[4])
    statement2 = _csv(
        ["txn_id", "from_account", "to_account", "amount", "timestamp", "narration"],
        statement2_rows,
    )

    cdr2: list[list[str]] = []
    for index, when in enumerate(clock.between("2026-03-20", "2026-04-30", 12)):
        pair = (c.deepak_phone, c.rohit_phone) if index % 2 else (c.rohit_phone, c.deepak_phone)
        cdr2.append([*pair, _ist(when), clock.duration()])
    for index, (when, seconds) in enumerate(deepak_pappu):
        pair = (
            (c.deepak_phone, c.pappu_phone) if index % 2 == 0 else (c.pappu_phone, c.deepak_phone)
        )
        cdr2.append([*pair, _ist(when), seconds])
    for when in clock.between("2026-03-05", "2026-04-20", 14):
        cdr2.append([c.deepak_phone, rng.choice(c.victim_phones), _ist(when), clock.duration()])
    for when, seconds in deepak_taxi:
        cdr2.append([c.deepak_phone, c.taxi_phone, _ist(when), seconds])
    cdr2.sort(key=lambda row: row[2])

    taxi_cdr: list[list[str]] = []
    for when, seconds in deepak_taxi:
        taxi_cdr.append([c.deepak_phone, c.taxi_phone, _ist(when), seconds])
    for when, seconds in pappu_taxi:
        taxi_cdr.append([c.pappu_phone, c.taxi_phone, _ist(when), seconds])
    for number in (*c.customer_phones, c.other_kiran_phone):
        for when in clock.between("2026-04-01", "2026-05-15", 3):
            taxi_cdr.append([number, c.taxi_phone, _ist(when), clock.duration()])
    for when in clock.between("2026-04-01", "2026-05-15", 6):
        taxi_cdr.append(
            [f"98{rng.randrange(10**7, 10**8)}", c.taxi_phone, _ist(when), clock.duration()]
        )
    taxi_cdr.sort(key=lambda row: row[2])

    files["BM-2"] = [
        CaseFile("BM2_FIR_098-2026.txt", "report", fir2, thane),
        CaseFile("BM2_driver_verification_note.txt", "report", note2, thane),
        CaseFile(
            "BM2_telecom_subscribers.csv",
            "subscriber_records",
            telecom2,
            "Telecom operator (notice response)",
        ),
        CaseFile("BM2_bank_kyc.csv", "subscriber_records", bank_kyc2, "Bank (KYC response)"),
        CaseFile("BM2_bank_statement.csv", "transactions", statement2, "Bank (account statement)"),
        CaseFile(
            "BM2_cdr_recruiter.csv",
            "call_records",
            _csv(["caller", "callee", "timestamp", "duration_sec"], cdr2),
            "Telecom operator (CDR)",
        ),
        CaseFile(
            "BM2_cdr_taxi_driver.csv",
            "call_records",
            _csv(["caller", "callee", "timestamp", "duration_sec"], taxi_cdr),
            "Telecom operator (CDR)",
        ),
    ]

    # BM-3 -----------------------------------------------------------------
    nashik = "Nashik Road Police Station"
    fir3 = _text(
        [
            "FIR No: 207/2026",
            f"Police Station: {nashik}",
            "Date: 2026-05-15",
            f"Accused: {c.pappu}",
            "Reference: FIR 207/2026 Nashik Road PS",
            "",
            "Three women who had been offered hotel jobs were reported missing from Nashik Road "
            "on 2026-05-12.",
            "Their families (identities withheld) said the women had been told to wait at the "
            "bus stand.",
            f"{c.pappu} was seen with the women near the bus stand on 2026-05-12, and a tea-stall "
            "owner, Ganesh Pawar, saw them board a white van.",
            f"{c.pappu} was traced through mobile {c.pappu_phone}.",
        ]
    )
    tip_sentence = (
        f"that {c.sameer}, using mobile {c.sameer_phone}, was in touch with {c.pappu} about "
        "moving the women from Nashik Road on 2026-05-12."
    )
    tip = _text(
        [
            "Title: Informant statement",
            f"Police Station: {nashik}",
            "Date: 2026-05-14",
            "Reference: GD 23/2026 Nashik Road PS",
            "",
            f"Informant stated {tip_sentence}",
        ]
    )
    diary = _text(
        [
            "Title: Station diary extract",
            f"Police Station: {nashik}",
            "Date: 2026-05-16",
            "Reference: GD 31/2026 Nashik Road PS",
            "",
            f"Recorded {tip_sentence}",
            "A white van was noticed at the Nashik Road bus stand on 2026-05-12.",
        ]
    )
    bulletin = _text(
        [
            "Title: District crime bulletin",
            "Police Station: Nashik District Crime Branch",
            "Date: 2026-05-18",
            "Reference: Bulletin 19/2026 Nashik District",
            "Source reference: GD 23/2026 Nashik Road PS",
            "",
            f"As per informant input, one {c.sameer} (mobile {c.sameer_phone}) is suspected of "
            f"coordinating with {c.pappu} to move women from Nashik Road on 12.05.2026.",
        ]
    )
    telecom3 = _csv(
        ["identifier", "identifier_type", "owner_name", "valid_from", "valid_to"],
        [
            [c.pappu_phone, "phone", c.pappu, "2024-08-10", ""],
            [c.sameer_phone, "phone", c.anil, "2026-04-20", ""],
            [c.deepak_phone, "phone", c.deepak, "2025-02-01", ""],
            [c.taxi_phone, "phone", c.taxi, "2019-03-01", ""],
        ],
    )
    # This operator exports in UTC with the country code attached.
    cdr3: list[list[str]] = []
    for index, when in enumerate(clock.between("2026-05-08", "2026-05-12", 9)):
        pair = (c.pappu_phone, c.sameer_phone) if index % 2 else (c.sameer_phone, c.pappu_phone)
        cdr3.append(["91" + pair[0], "91" + pair[1], _utc(when), clock.duration()])
    for index, (when, seconds) in enumerate(deepak_pappu):
        pair = (
            (c.deepak_phone, c.pappu_phone) if index % 2 == 0 else (c.pappu_phone, c.deepak_phone)
        )
        cdr3.append(["91" + pair[0], "91" + pair[1], _utc(when), seconds])
    for when, seconds in pappu_taxi:
        cdr3.append(["91" + c.pappu_phone, "91" + c.taxi_phone, _utc(when), seconds])
    for when in clock.between("2026-04-15", "2026-05-20", 10):
        cdr3.append(
            [
                "91" + c.pappu_phone,
                f"9198{rng.randrange(10**7, 10**8)}",
                _utc(when),
                clock.duration(),
            ]
        )
    cdr3.sort(key=lambda row: row[2])

    files["BM-3"] = [
        CaseFile("BM3_FIR_207-2026.txt", "report", fir3, nashik),
        CaseFile("BM3_informant_tip_GD23.txt", "report", tip, nashik),
        CaseFile("BM3_station_diary_GD31.txt", "report", diary, nashik),
        CaseFile("BM3_district_bulletin.txt", "report", bulletin, "Nashik District Crime Branch"),
        CaseFile(
            "BM3_telecom_subscribers.csv",
            "subscriber_records",
            telecom3,
            "Telecom operator (notice response)",
        ),
        CaseFile(
            "BM3_cdr_accused.csv",
            "call_records",
            _csv(["caller", "callee", "timestamp", "duration_sec"], cdr3),
            "Telecom operator (CDR, UTC)",
        ),
    ]
    return files


def ground_truth(cast: Cast) -> dict:
    """What really happened. Read by evaluation and tests only."""
    c = cast
    people = {
        "vikram": c.vikram,
        "sameer": c.sameer,
        "rohit": c.rohit,
        "kiran": c.kiran,
        "deepak": c.deepak,
        "pappu": c.pappu,
        "anil": c.anil,
        "taxi": c.taxi,
        "other_kiran": c.kiran,
        **{f"customer_{i}": name for i, name in enumerate(c.customers)},
    }
    references = {
        "BM-1": {c.vikram: "vikram", c.sameer: "sameer", c.rohit: "rohit", c.kiran: "kiran"},
        "BM-2": {
            c.deepak: "deepak",
            c.rohit: "rohit",
            c.pappu: "pappu",
            c.taxi: "taxi",
            c.kiran: "other_kiran",
            **{name: f"customer_{i}" for i, name in enumerate(c.customers)},
        },
        # The tip's "Sameer Khan" means BM-1's recovery agent: the informant
        # knew the number's old registration. The name is right; the claim is not.
        "BM-3": {
            c.pappu: "pappu",
            c.anil: "anil",
            c.deepak: "deepak",
            c.taxi: "taxi",
            c.sameer: "sameer",
        },
    }
    return {
        "scenario": SCENARIO_NAME,
        "seed": c.seed,
        "cast": asdict(c),
        "people": people,
        "references": references,
        # Who really used each number, and when.
        "phone_users": {
            c.vikram_phone: [["vikram", None, None]],
            c.sameer_phone: [["sameer", None, "2026-04-01"], ["anil", "2026-04-20", None]],
            c.rohit_phone: [["rohit", None, None]],
            c.kiran_phone: [["kiran", None, None]],
            c.other_kiran_phone: [["other_kiran", None, None]],
            c.deepak_phone: [["deepak", None, None]],
            c.pappu_phone: [["pappu", None, None]],
            c.taxi_phone: [["taxi", None, None]],
            **{n: [[f"customer_{i}", None, None]] for i, n in enumerate(c.customer_phones)},
        },
        "account_holders": {
            c.mule_account: "kiran",
            c.rohit_account: "rohit",
            c.vikram_account: "vikram",
            c.deepak_account: "deepak",
        },
        # Undirected relationships that really exist between people.
        "true_relations": [
            ["sameer", "vikram"],
            ["rohit", "vikram"],
            ["kiran", "rohit"],
            ["kiran", "vikram"],
            ["deepak", "rohit"],
            ["deepak", "pappu"],
            ["anil", "pappu"],
            ["deepak", "taxi"],
            ["pappu", "taxi"],
            ["other_kiran", "taxi"],
            *[[f"customer_{i}", "taxi"] for i in range(len(c.customers))],
        ],
        # A path through this person says nothing about the people at either end.
        "benign_hubs": ["taxi"],
        # Every statement in these documents repeats the one false allegation.
        "false_claim_files": [
            "BM3_informant_tip_GD23.txt",
            "BM3_station_diary_GD31.txt",
            "BM3_district_bulletin.txt",
        ],
        "copies_of_one_origin": {
            "origin": "BM3_informant_tip_GD23.txt",
            "declared": ["BM3_district_bulletin.txt"],
            "undeclared": ["BM3_station_diary_GD31.txt"],
        },
        # Real criminal links between the accused of different cases, at any length.
        "connected_accused": [
            [c.vikram, c.deepak],
            [c.sameer, c.deepak],
            [c.vikram, c.pappu],
            [c.deepak, c.pappu],
            [c.sameer, c.pappu],
        ],
        "direct_false_relation": [c.sameer, c.pappu],
    }


def write_assets(out_dir: Path = OUTPUT_DIR, cast: Cast | None = None) -> Path:
    cast = cast or default_cast()
    out_dir.mkdir(parents=True, exist_ok=True)
    for case_files in build_case_files(cast).values():
        for item in case_files:
            (out_dir / item.filename).write_bytes(item.raw)
    with (out_dir / "ground_truth.json").open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(ground_truth(cast), handle, indent=2)
    return out_dir


def cast_for(seed: int) -> Cast:
    return default_cast() if seed == DEFAULT_SEED else random_cast(seed)


def with_seed(cast: Cast, seed: int) -> Cast:
    return replace(cast, seed=seed)


if __name__ == "__main__":
    print(f"Wrote Operation Broken Mirror to {write_assets()}")
