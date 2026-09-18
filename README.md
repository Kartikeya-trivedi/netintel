# NetIntel

**AI-powered criminal network analysis and intelligence platform.**

Investigative data arrives fragmented: unstructured police reports, bank
statements, call detail records. The links that matter live *between* those
sources, which is exactly where manual review breaks down. NetIntel ingests all
three, extracts entities and relationships with NLP, assembles a single
knowledge graph, and runs network analytics over it to surface the people who
hold a syndicate together.

> For authorized law-enforcement use. All demo data in this repository is
> synthetic. No real person, account, or case is represented.

---

## What it does

- **Ingests** police reports (`.txt`, `.pdf`, `.docx`), transaction logs, and
  call records (`.csv`), parsing each into a common representation.
- **Extracts** people, organisations, locations, phone numbers, bank accounts,
  vehicles, and contraband using spaCy NER plus deterministic domain patterns
  tuned for Indian investigative documents.
- **Resolves** aliases and surface variants into single canonical entities, so
  "Ramesh Kulkarni", "Kulkarni, Ramesh", and "Raja" become one node.
- **Builds** an evidence-backed knowledge graph. Every edge stores the sentence
  or transaction rows that produced it.
- **Analyses** structure: degree, betweenness, eigenvector, and PageRank
  centrality; Louvain community detection; shortest paths; articulation points;
  and key-player removal simulation.
- **Flags** behavioural anomalies: transaction spikes, structuring patterns,
  communication bursts, and entities newly rising in centrality.

### The core idea

A syndicate's most important person is rarely its most visible one. A
coordinator who appears briefly in three unrelated reports has low degree
centrality but very high **betweenness** — every path between cells runs through
them. Counting mentions will never surface that person. Graph structure will.
NetIntel is built around that gap, and the removal-simulation view turns the
insight into an operational recommendation: *this* arrest fragments the network
into three disconnected pieces.

---

## Investigation workspace

`MASTER_PLAN.md` moves NetIntel from a graph viewer to a workspace that
**discovers connections across authorised case files, shows what each one rests
on, lets an investigator challenge it, and points at the check that would
change the most**. That layer lives in `backend/app/investigation/` and the
**Findings** tab. It is additive: the older per-case pipeline and views are
untouched.

- **Originals first.** Every upload is kept byte for byte in a content-addressed
  store before anything parses it, and re-hashed whenever it is read or exported.
- **Statements, not a merged graph.** Each row or sentence becomes a typed
  statement with its exact source text. Records (a CDR row) and claims (a
  sentence in a report) are never mixed up.
- **Every dependency kept.** A call between two people holds only while the call
  row *and* both numbers' holders at that moment hold; a second derivation is a
  second way to hold, not extra weight. Withdrawing a source removes exactly what
  depended on it.
- **Time-scoped identities.** A number belongs to whoever held it on the day of
  the call. Same-name references in different cases stay separate until an
  investigator accepts, with cited evidence, that they are one person.
- **Repeats are one origin.** A tip copied into a diary and paraphrased into a
  bulletin counts once, with the reason for the grouping shown and reviewable.
- **Challenge and verify.** Scenarios recompute every finding; the sensitivity
  search reports the smallest withdrawals that break a finding, with its search
  limits; verification tasks show what each possible answer would change.
- **Decisions are versioned** (optimistic concurrency, history kept), access is
  bound to case grants and their stated purpose, and a finding exports as a
  signed package (Ed25519) that verifies and recomputes away from the server.

### Try the flagship scenario

Operation Broken Mirror is three synthetic case files (loan-app extortion,
fake job recruitment, a missing-women inquiry) with one real bridge and one
false one: an informant tip, repeated in two later documents, pins calls on a
number that had already been re-issued to someone else.

Open the **Findings** tab and choose *Load Operation Broken Mirror*, or:

```bash
curl -X POST http://localhost:8000/api/demo/broken-mirror/reset
```

Every workspace request names a demo identity in the `X-Principal` header
(`inspector.rao`, `supervisor.iyer`, or `analyst.das`, who may see one case only).
This is a stand-in for authentication, not authentication.

Verify an exported package independently, with a public key obtained separately:

```bash
cd backend
curl -o key.pem http://localhost:8000/api/receipts/public-key
uv run python -m app.investigation.verify netintel-<finding>-v1.zip --public-key key.pem --reproduce
```

### What has been measured

`uv run python -m app.investigation.evaluate` scores the workflow against
ground truth that the analysis path never reads, on five generated variants of
the scenario (different names, numbers and times, same structure):

| Per variant | Ordinary resolved graph | This workspace |
|---|---|---|
| Connections asserted as supported | 5 | 4 |
| of which false | 1 | 0 |
| Supported connections whose first explanation is unsound | 3 | 0 |
| Connections raised for review instead (false among them) | 0 | 1 (1) |

Checks needed before no false lead or assertion remains: **1** in the
planner's order on every variant, against 3.3 to 5.4 on average (worst 7 to 9)
in random order.

These are synthetic scenarios generated by this repository. They show the
behaviour on those scenarios; they are not field accuracy and do not measure
investigative effectiveness.

---

## Architecture

```
Reports / CSVs
      |
      v
  Ingestion  ──►  Extraction  ──►  Entity resolution
 (parsers)        (spaCy NER +      (fuzzy + exact
                   rule patterns)     matching)
                                          |
                                          v
                                   Knowledge graph  ──►  Analytics
                                     (SQLite)             (NetworkX:
                                          |                centrality,
                                          |                communities,
                                          v                paths, removal)
                                  Anomaly detection
                                  (spikes, structuring,
                                   comm bursts)
                                          |
                                          v
                                   React + Cytoscape
                                   investigator console
```

| Layer | Technology |
|---|---|
| API | Python 3.12, FastAPI, SQLAlchemy, SQLite |
| NLP | spaCy (+ optional Claude-assisted relation extraction) |
| Graph | NetworkX |
| Anomaly detection | pandas, scikit-learn |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS v4 |
| Visualisation | Cytoscape.js (network), Recharts (timelines) |
| Packaging | `uv` (Python), `npm` (frontend) |

Deliberately **not** used: Neo4j, Kafka, and a real auth stack. See
[Production roadmap](#production-roadmap).

---

## Quick start

Requires [uv](https://docs.astral.sh/uv/), Node.js 22+, and Python 3.12+.

### Backend

```bash
cd backend
uv sync --all-groups
uv run python -m spacy download en_core_web_lg
uv run uvicorn app.main:app --reload
```

API docs at http://localhost:8000/docs

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Console at http://localhost:5173 (requests to `/api` proxy to the backend).

### Everything at once

```bash
docker compose up --build
```

### Seed the demo case

```bash
cd backend
uv run python -m app.seed.generate_demo_data
uv run python -m app.seed.load_demo
```

`POST /api/demo/reset` re-seeds from a clean slate mid-demo.

---

## Repository layout

```
backend/          FastAPI service — see backend/README.md
  app/investigation/   Originals, statements, findings, challenges, signed exports
frontend/         React investigator console (the Findings tab is the workspace)
PLAN.md           Original implementation plan, phased with milestones
MASTER_PLAN.md    Product direction: discover, challenge, verify
```

Configuration lives in `.env` (copy `.env.example`). NetIntel runs entirely
offline: `USE_LLM_EXTRACTION` defaults to `false` and no API key is required.

---

## Development status

Scaffolded and phased. `PLAN.md` is the source of truth; each service module
carries a `TODO(Phase N)` pointing at the section that specifies it.

| Phase | Scope | Status |
|---|---|---|
| 0 | Scaffold, data model, API skeleton, CI | Complete |
| 1 | Demo data generator, ingestion, parsers | Complete |
| 2 | NER, relation extraction, entity resolution | Complete |
| 3 | Graph construction and analytics | Complete |
| 4 | Graph Explorer and Documents UI | Complete |
| 5 | Anomaly engine, Alerts, Dashboard | Next |
| 6 | Entity dossiers, removal simulation, polish | Planned |

The backend pipeline runs end to end today: drop in reports and CSVs, and the
system extracts entities, resolves aliases, builds the graph, and ranks key
players. `backend/tests/test_demo_case.py` asserts every claim the demo makes,
including that betweenness surfaces the planted coordinator **and** that degree
centrality does not. Without that second assertion the first proves nothing.

Tests for unimplemented phases are committed as `xfail`, so they flip to passing
as each phase lands rather than being written after the fact.

```bash
cd backend && uv run pytest -q
```

---

## Production roadmap

Out of scope for the prototype, and the honest list of what real deployment
would require: real authentication (the investigation layer enforces case
grants, purposes and a hash-chained audit log, but trusts a demo identity
header, and the older case routes enforce nothing), key custody in an HSM or
KMS rather than a key file, PostgreSQL in place of SQLite, a dedicated graph
database once the network outgrows in-process NetworkX, durable job workers for
extraction and scenarios, OCR for scanned FIRs, measured extraction quality on
real Hindi and English documents, and a separately governed protocol before any
matching across agencies.

---

## Licence

MIT — see [LICENSE](LICENSE).
