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
backend/    FastAPI service — see backend/README.md
frontend/   React investigator console
PLAN.md     Full implementation plan, phased with milestones
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
| 4 | Graph Explorer and Documents UI | Next |
| 5 | Anomaly engine, Alerts, Dashboard | Planned |
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
would require: role-based access control and audit logging, a dedicated graph
database once the network outgrows in-process NetworkX, streaming ingestion,
multi-tenancy with case-level isolation, OCR for scanned FIRs, and a
human-in-the-loop review queue so no extracted link reaches an investigator
without the option of correction.

---

## Licence

MIT — see [LICENSE](LICENSE).
