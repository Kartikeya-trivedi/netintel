# NetIntel — Implementation Plan

**AI-Powered Criminal Network Analysis and Intelligence Platform**
Target: Smart India Hackathon 2026 · Working demo-quality product
Audience: This plan is written for an implementing agent (Claude Opus). Follow phases in order; each phase ends with a verifiable milestone.

---

## 1. Product summary

NetIntel ingests fragmented investigative data (unstructured police reports, financial transaction logs, call/communication records), extracts entities and relationships with NLP, builds a knowledge graph, runs graph analytics (centrality, community detection, shortest paths) to surface kingpins and structural vulnerabilities, flags anomalies (transaction spikes, unusual communication bursts), and presents everything in an interactive investigator dashboard.

**Important framing:** this is an analysis/intelligence tool for authorized law enforcement on lawful data. All demo data must be synthetic. Include a disclaimer in the UI footer and README.

---

## 2. Tech stack (chosen for hackathon speed + demo impact)

| Layer | Choice | Rationale |
|---|---|---|
| Backend API | Python 3.11+ / FastAPI | Fast to build, auto OpenAPI docs, async |
| NLP | spaCy (`en_core_web_trf` if GPU/space allows, else `en_core_web_lg`) + custom rule-based patterns | Reliable NER out of the box; transformer optional |
| Optional LLM extraction | Claude API (claude-sonnet-5) behind a feature flag `USE_LLM_EXTRACTION` | Relationship extraction quality jump for demo; must degrade gracefully to spaCy-only when no API key |
| Graph engine | NetworkX (in-process) | Zero infra, all needed algorithms built in. Do NOT use Neo4j — infra overhead kills hackathon velocity |
| Persistence | SQLite via SQLAlchemy | Zero-config, file-based, sufficient scale |
| Anomaly detection | pandas + scikit-learn (IsolationForest, z-score) | Simple, explainable |
| Frontend | React 18 + Vite + TypeScript | Standard |
| Graph viz | Cytoscape.js (`react-cytoscapejs`) | Best interactivity: selection, layouts, styling by metric |
| Charts | Recharts | Timeline/anomaly charts |
| UI kit | Tailwind CSS (dark theme, "intelligence console" aesthetic) | Fast, distinctive |
| Deployment | `docker-compose` (api + web), plus plain `npm run dev` / `uvicorn` for local dev | Judges can run one command |

No auth system beyond a hardcoded demo login screen (optional, Phase 6 polish) — do not spend time on real auth.

---

## 3. Repository layout

```
sih2026/
├── PLAN.md                     # this file
├── README.md                   # setup, demo script, architecture diagram
├── docker-compose.yml
├── backend/
│   ├── pyproject.toml          # or requirements.txt; pin versions
│   ├── app/
│   │   ├── main.py             # FastAPI app, CORS, routers
│   │   ├── config.py           # env settings (pydantic-settings)
│   │   ├── db.py               # SQLAlchemy engine/session
│   │   ├── models.py           # ORM: Case, Document, Entity, Relationship, Transaction, CommEvent, Alert
│   │   ├── schemas.py          # Pydantic response models
│   │   ├── routers/
│   │   │   ├── cases.py
│   │   │   ├── ingest.py       # upload endpoints
│   │   │   ├── graph.py        # graph + analytics endpoints
│   │   │   ├── entities.py
│   │   │   ├── alerts.py
│   │   │   └── search.py
│   │   ├── services/
│   │   │   ├── extraction/
│   │   │   │   ├── ner.py          # spaCy pipeline + custom EntityRuler patterns
│   │   │   │   ├── relations.py    # co-occurrence + dependency-pattern relation extraction
│   │   │   │   ├── llm_extractor.py# optional Claude-based extraction (feature-flagged)
│   │   │   │   └── resolver.py     # entity resolution (fuzzy dedupe)
│   │   │   ├── ingest/
│   │   │   │   ├── report_parser.py    # txt/pdf/docx → text
│   │   │   │   ├── csv_ingest.py       # transactions & call records
│   │   │   │   └── pipeline.py         # orchestrates ingest → extract → resolve → persist
│   │   │   ├── graph/
│   │   │   │   ├── builder.py      # DB → NetworkX graph
│   │   │   │   └── analytics.py    # centrality, communities, paths, key-player removal
│   │   │   └── anomaly/
│   │   │       └── detector.py     # transaction & comm anomaly detection → Alerts
│   │   └── seed/
│   │       ├── generate_demo_data.py   # synthetic case generator (see §7)
│   │       └── demo_assets/            # generated reports/CSVs checked in
│   └── tests/
│       ├── test_extraction.py
│       ├── test_graph_analytics.py
│       ├── test_anomaly.py
│       └── test_api.py
└── frontend/
    ├── package.json
    ├── src/
    │   ├── api/client.ts
    │   ├── pages/
    │   │   ├── Dashboard.tsx       # case overview, stats, alert feed
    │   │   ├── GraphExplorer.tsx   # the centerpiece
    │   │   ├── Documents.tsx       # upload + parsed doc view with entity highlights
    │   │   ├── Alerts.tsx
    │   │   └── EntityProfile.tsx   # dossier view per entity
    │   ├── components/
    │   │   ├── NetworkGraph.tsx    # Cytoscape wrapper
    │   │   ├── TimelineChart.tsx
    │   │   ├── AlertCard.tsx
    │   │   ├── EntityBadge.tsx
    │   │   └── HighlightedText.tsx # report text with colored entity spans
    │   └── ...
    └── ...
```

---

## 4. Data model (SQLAlchemy)

- **Case**(id, name, description, created_at)
- **Document**(id, case_id, filename, doc_type[report|transactions|call_records], raw_text, status[pending|processed|failed], uploaded_at)
- **Entity**(id, case_id, canonical_name, entity_type[PERSON|ORG|LOCATION|PHONE|BANK_ACCOUNT|VEHICLE|WEAPON|DRUG], aliases JSON, metadata JSON, first_seen_doc_id)
- **Mention**(id, entity_id, document_id, span_start, span_end, surface_text) — powers text highlighting and provenance
- **Relationship**(id, case_id, source_entity_id, target_entity_id, rel_type[ASSOCIATES_WITH|TRANSACTED_WITH|CALLED|LOCATED_AT|MEMBER_OF|OWNS], weight, evidence JSON list of {doc_id, snippet})
- **Transaction**(id, case_id, from_account, to_account, amount, timestamp, from_entity_id?, to_entity_id?)
- **CommEvent**(id, case_id, caller, callee, timestamp, duration_sec, caller_entity_id?, callee_entity_id?)
- **Alert**(id, case_id, alert_type[TRANSACTION_SPIKE|STRUCTURING|COMM_BURST|NEW_LINK|HIGH_CENTRALITY_SHIFT], severity[low|med|high], title, description, entity_ids JSON, evidence JSON, created_at, status[open|reviewed])

Every analytic claim in the UI must trace back to evidence (doc snippet or transaction rows). Provenance is the differentiator judges care about.

---

## 5. Backend pipeline details

### 5.1 Ingestion
- `POST /api/cases/{id}/documents` — multipart upload. Detect type by extension + user-selected doc_type.
- Parsers: `.txt` direct; `.pdf` via `pypdf`; `.docx` via `python-docx`; `.csv` via pandas with column-mapping heuristics (expect canonical headers from demo generator, but tolerate common variants: `amount|amt`, `date|timestamp`, etc.).
- Processing runs in a FastAPI `BackgroundTask`; document status polled by frontend.

### 5.2 Entity extraction (`ner.py`)
- spaCy NER for PERSON/ORG/GPE/LOC.
- `EntityRuler` + regex for domain entities: Indian phone numbers (`+91`/10-digit), bank account numbers, IFSC codes, vehicle registration plates (e.g., `MH 12 AB 1234`), FIR numbers, aliases in quotes ("Raja"), drug/weapon keyword lexicons.
- Output: list of (surface_text, label, span).

### 5.3 Relation extraction (`relations.py`)
- Baseline: sentence-level co-occurrence → `ASSOCIATES_WITH` with weight = co-occurrence count; keep the sentence as evidence snippet.
- Pattern rules for stronger types: "X paid/transferred to Y" → TRANSACTED_WITH; "X called/contacted Y" → CALLED; "X, a member of Y-gang" → MEMBER_OF; "X was seen at L" → LOCATED_AT.
- If `USE_LLM_EXTRACTION=true` and `ANTHROPIC_API_KEY` set: send each report chunk to Claude with a JSON-schema prompt returning entities+typed relations; merge with rule output. Wrap in try/except — any failure falls back silently to rule-based results.

### 5.4 Entity resolution (`resolver.py`)
- Normalize (casefold, strip honorifics like Shri/Mr).
- Fuzzy match via `rapidfuzz` token_sort_ratio ≥ 90 within same entity_type → merge into canonical entity, keep aliases.
- Phone numbers/accounts: exact match after normalization.
- Link CSV rows to entities: transaction accounts and call numbers matched against extracted BANK_ACCOUNT/PHONE entities and via an `owns` mapping in the demo data (a "KYC/subscriber records" CSV mapping account/phone → person name — realistic and makes cross-source linking demonstrable).

### 5.5 Graph analytics (`analytics.py`)
Build weighted undirected multigraph (or DiGraph for money flow) from Relationships + linked Transactions/CommEvents. Endpoints:

- `GET /api/cases/{id}/graph` — nodes (with type, metrics) + edges (with type, weight, evidence refs), Cytoscape-ready JSON.
- `GET .../graph/metrics` — degree, betweenness, eigenvector, PageRank per node; top-N "key players".
- `GET .../graph/communities` — Louvain (`networkx.community.louvain_communities`); return community id per node + summary (size, dominant entity types, top member).
- `GET .../graph/path?source=&target=` — shortest path with edge evidence (the "how is A connected to B?" demo moment).
- `GET .../graph/vulnerabilities` — articulation points + "key player removal" simulation: for each top-centrality node, report number of connected components / largest-component size after removal. This is the "structural vulnerability" pitch line.

Cache computed metrics per case; invalidate on new ingest.

### 5.6 Anomaly detection (`detector.py`)
Run after ingest; write Alerts.
- **Transaction spike:** per account, daily totals; z-score > 3 vs that account's history → alert.
- **Structuring:** ≥3 transactions each within 10% below a threshold (e.g., ₹50,000) in a 7-day window from same account → high-severity alert.
- **Comm burst:** per number-pair, IsolationForest or simple rate change (calls/day > mean + 3σ) → alert. Bonus rule: burst within 48h *before* a date tagged as an "incident" in the case metadata.
- **High-centrality shift:** after each ingest, if a node's betweenness rank jumps into top 5 → informational alert ("emerging coordinator").
Each alert stores evidence rows and entity ids so the UI can deep-link into graph + timeline.

---

## 6. Frontend

Dark "intelligence console" theme. Pages:

1. **Dashboard** — case selector, stat tiles (entities, links, docs, open alerts), recent alerts feed, mini network preview. Load the `frontend-design` skill before building UI to avoid a generic look; load `dataviz` before charts.
2. **Graph Explorer (centerpiece)**
   - Cytoscape canvas, force-directed (`cose-bilkent` or `fcose` layout).
   - Node size ∝ selected centrality metric (dropdown: degree/betweenness/PageRank); node color by community or by entity type (toggle); edge thickness ∝ weight; edge style by type.
   - Click node → side panel: entity dossier (aliases, metrics, community, mentions with doc links, related alerts).
   - Click edge → evidence snippets.
   - Toolbar: search/focus entity, filter by entity type & relationship type, "Top-10 key players" highlight, "Find path A→B", "Simulate removal" (removes node, re-lays out, shows fragmentation stats).
3. **Documents** — upload dropzone; list with processing status; document view showing raw text with colored entity highlight spans (from Mentions); "entities found" sidebar.
4. **Alerts** — filterable list; each card links to involved entities in Graph Explorer and shows a Recharts timeline of the anomalous series with the anomaly window shaded.
5. **Entity Profile** — full dossier: transactions in/out chart, call activity timeline, ego-network mini-graph, evidence list.

---

## 7. Synthetic demo data (`generate_demo_data.py`)

Deterministic (seeded) generator producing one rich case: **"Operation Nightfall" — a ~25-person smuggling syndicate**.

- Ground-truth network: 1 kingpin (deliberately low direct visibility, high betweenness via 2 lieutenants — makes the "AI found the hidden kingpin" demo land), 2 lieutenants, 3 cells of 5–6 members, 1 launderer bridging to a shell company, couriers connecting cells.
- Outputs into `seed/demo_assets/`:
  - 12–15 synthetic police report `.txt` files (2–4 paragraphs each, natural prose naming people/aliases/places/vehicles/events) — hand-template with slot-filling so NER reliably works.
  - `transactions.csv` (~500 rows, 90 days; columns: `txn_id, from_account, to_account, amount, timestamp` ISO-8601) with embedded spike + structuring patterns for the launderer.
  - `call_records.csv` (~800 rows; columns: `caller, callee, timestamp, duration_sec`) with a comm burst before a scripted "incident date".
  - `subscriber_records.csv` (columns: `identifier, identifier_type[phone|account], owner_name`) mapping phones/accounts → names.
- `python -m app.seed.generate_demo_data && python -m app.seed.load_demo` seeds the DB; also expose `POST /api/demo/reset` for live demos.
- Verify end-to-end: after seeding, betweenness top-3 must include the kingpin, Louvain must find ≥3 communities, and ≥3 alerts must fire. **Make this an automated test** — it is the demo's safety net.

---

## 8. Phases & milestones (implement in this order)

**Phase 0 — Scaffold (small):** repo layout, FastAPI hello + CORS, Vite React app, SQLite models, docker-compose. ✅ Milestone: both servers run, `/docs` loads.

**Phase 1 — Demo data + ingestion:** generator, upload endpoints, parsers, pipeline skeleton persisting Documents. ✅ Milestone: seed script loads all assets; docs visible via API.

**Phase 2 — NLP extraction + resolution:** ner.py, relations.py, resolver.py, Mentions. ✅ Milestone: `test_extraction.py` passes; entities/relations from demo reports match expectations (kingpin appears, aliases merged).

**Phase 3 — Graph + analytics:** builder, metrics, communities, paths, vulnerabilities, caching. ✅ Milestone: `test_graph_analytics.py` passes incl. hidden-kingpin assertion.

**Phase 4 — Frontend Graph Explorer + Documents:** the core UI. ✅ Milestone: interactive graph with metric sizing, community coloring, dossier panel, path finding; document highlight view.

**Phase 5 — Anomaly engine + Alerts UI + Dashboard.** ✅ Milestone: seeded case fires spike/structuring/burst alerts; alert → graph deep links work.

**Phase 6 — Polish:** entity profile page, removal simulation, empty/loading states, README with architecture diagram + 3-minute demo script, docker-compose verified from clean clone, optional demo login screen, UI disclaimer ("For authorized law-enforcement use; demo uses synthetic data").

---

## 9. Testing & quality bar

- pytest for extraction, analytics, anomaly, and API smoke tests; the seeded-case end-to-end assertion (§7) is mandatory.
- Type hints throughout backend; strict TS on frontend.
- Handle: empty/garbage uploads (status=failed with reason), re-ingest idempotency (dedupe by file hash), large graph fallback (if >500 nodes, default filter to top-N by degree).

## 10. Explicit non-goals (do not build)

Real auth/RBAC, Neo4j, Kafka/queues, multi-tenancy, mobile UI, real OCR of scanned FIRs (PDF text-layer only), model training. Mention these in README as "production roadmap" — judges like seeing you know the difference.

## 11. Demo script (put in README)

1. Reset demo → empty case. Upload the report bundle live; watch entities/links appear.
2. Open Graph Explorer → switch sizing to betweenness → "the system surfaces a coordinator who never appears prominently in any single report."
3. Community view → three cells + laundering cluster.
4. Path finder: street courier → shell company.
5. Alerts: structuring pattern with transaction evidence chart.
6. Removal simulation: remove kingpin → network fragments into 3 components. "This is the arrest that dismantles the syndicate."
