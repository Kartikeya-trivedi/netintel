# NetIntel backend

FastAPI service: ingestion, NLP extraction, graph analytics, anomaly detection.

## Setup

```bash
uv sync --all-groups
uv run python -m spacy download en_core_web_lg   # required for Phase 2 onward
```

## Run

```bash
uv run uvicorn app.main:app --reload
```

API docs: http://localhost:8000/docs

## Test and lint

```bash
uv run pytest -q
uv run ruff check .
```

## Seed the demo case

```bash
uv run python -m app.seed.generate_demo_data
uv run python -m app.seed.load_demo
```

## Layout

| Path | Role |
|---|---|
| `app/models.py` | ORM data model (see PLAN.md section 4) |
| `app/routers/` | HTTP surface, one module per resource |
| `app/services/extraction/` | spaCy NER, relation rules, entity resolution |
| `app/services/ingest/` | File parsing and the ingest pipeline |
| `app/services/graph/` | NetworkX construction and analytics |
| `app/services/anomaly/` | Detectors that produce Alert rows |
| `app/seed/` | Synthetic demo case generator |
